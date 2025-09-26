use crate::{
    error::MultisigError, state::{ChallengeArgs, CompressedSettings, DomainConfig, MemberKey, Permission, ProofArgs,  Secp256r1VerifyArgsWithDomainAddress, Settings, SettingsMutArgs, TransactionActionType, SEED_MULTISIG}, utils::durable_nonce_check, LIGHT_CPI_SIGNER
};
use anchor_lang::{prelude::*, solana_program::{hash, sysvar::SysvarId}};
use light_sdk::{
    account::LightAccount, cpi::{CpiAccounts, CpiInputs}
};
use std::vec;

#[derive(Accounts)]
#[instruction(settings_mut: SettingsMutArgs)]
pub struct DecompressSettingsAccount<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(), 
        seeds = [
            SEED_MULTISIG,  
            settings_mut.data.data.as_ref().unwrap().index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub settings: AccountLoader<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> DecompressSettingsAccount<'info> {
    fn validate(
        &self,
        remaining_accounts: &'info [AccountInfo<'info>],
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_mut: &SettingsMutArgs,
    ) -> Result<()> {
        let Self {
            settings,
            slot_hash_sysvar,
            instructions_sysvar,
            payer,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let settings_data = settings_mut.data.data.as_ref().unwrap();
        let threshold = settings_data.threshold as usize;
        let secp256r1_member_keys: Vec<(MemberKey, &Secp256r1VerifyArgsWithDomainAddress)> =
            secp256r1_verify_args
                .iter()
                .filter_map(|arg| {
                    let pubkey = arg
                        .verify_args
                        .extract_public_key_from_instruction(Some(&self.instructions_sysvar))
                        .ok()?;

                    let member_key = MemberKey::convert_secp256r1(&pubkey).ok()?;

                    Some((member_key, arg))
                })
                .collect();
        for member in &settings_data.members {
            let has_permission = |perm| member.permissions.has(perm);

            let secp256r1_signer = secp256r1_member_keys
                .iter()
                .find(|f| f.0.eq(&member.pubkey));
            let is_signer = secp256r1_signer.is_some()
                || remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .unwrap()
                            .eq(&member.pubkey)
                });

            if is_signer {
                if has_permission(Permission::InitiateTransaction) {
                    initiate = true;
                }
                if has_permission(Permission::ExecuteTransaction) {
                    execute = true;
                }
                if has_permission(Permission::VoteTransaction) {
                    vote_count += 1;
                }
            }

             if let Some((_, secp256r1_verify_data)) = secp256r1_signer {   
                let account_loader = DomainConfig::extract_domain_config_account(
                    remaining_accounts,
                    secp256r1_verify_data.domain_config_key,
                )?;


                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: settings.key(),
                        message_hash: hash::hash(&payer.key().to_bytes()).to_bytes(),
                        action_type: TransactionActionType::Decompress,
                    },
                )?;
            }
        }

        require!(
            initiate,
            MultisigError::InsufficientSignerWithInitiatePermission
        );
        require!(
            execute,
            MultisigError::InsufficientSignerWithExecutePermission
        );
        require!(
            vote_count >= threshold,
            MultisigError::InsufficientSignersWithVotePermission
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx.remaining_accounts, &secp256r1_verify_args, &settings_mut))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        settings_mut: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings.load_init()?;

        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.payer.as_ref(),
            &ctx.remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

         let mut settings_account = LightAccount::<'_, CompressedSettings>::new_mut(
            &crate::ID,
            &settings_mut.account_meta,
            settings_mut.data,
        )
        .map_err(ProgramError::from)?;

        let settings_data = settings_account.data.as_ref().unwrap();
        settings.set_threshold(settings_data.threshold)?;
        settings.multi_wallet_bump = settings_data.multi_wallet_bump;
        settings.bump = ctx.bumps.settings;
        settings.index = settings_data.index;
        settings.set_members(settings_data.members.clone())?;
        settings.invariant()?;

        settings_account.data = None;

        let settings_info = settings_account
            .to_account_info()
            .map_err(ProgramError::from)?;
        
        let cpi_inputs = CpiInputs::new(
            compressed_proof_args.proof,
            vec![settings_info],
        );
        cpi_inputs.invoke_light_system_program(light_cpi_accounts).map_err(ProgramError::from)?;
        Ok(())
    }
}

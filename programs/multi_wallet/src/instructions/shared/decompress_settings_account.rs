use crate::{
    durable_nonce_check,
    utils::{MultisigSettings, MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS},
    ChallengeArgs, CompressedSettings, DomainConfig, MemberKey, MultisigError, Permission,
    ProofArgs, Secp256r1VerifyArgsWithDomainAddress, Settings, SettingsMutArgs,
    TransactionActionType, LIGHT_CPI_SIGNER, SEED_MULTISIG,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    LightAccount,
};
use light_sdk::{
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
};
use std::vec;

#[derive(Accounts)]
#[instruction(settings_mut_args: SettingsMutArgs)]
pub struct DecompressSettingsAccount<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS), 
        seeds = [
            SEED_MULTISIG,  
            settings_mut_args.data.data.as_ref().ok_or(MultisigError::MissingSettingsData)?.index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub settings: Account<'info, Settings>,
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
        settings_mut_args: &SettingsMutArgs,
    ) -> Result<()> {
        let Self {
            settings,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let settings_data = settings_mut_args
            .data
            .data
            .as_ref()
            .ok_or(MultisigError::MissingSettingsData)?;
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
                            .map_or(false, |key| key.eq(&member.pubkey))
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
                        message_hash: Sha256::hash(&settings.key().to_bytes())
                            .map_err(|_| MultisigError::HashComputationFailed)?,
                        action_type: TransactionActionType::Decompress,
                    },
                    &[],
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

    #[access_control(ctx.accounts.validate(&ctx.remaining_accounts, &secp256r1_verify_args, &settings_mut_args))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;

        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.payer.as_ref(),
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let mut settings_account = LightAccount::<CompressedSettings>::new_mut(
            &crate::ID,
            &settings_mut_args.account_meta,
            settings_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        let settings_data = settings_account
            .data
            .as_ref()
            .ok_or(MultisigError::MissingSettingsData)?;
        settings.set_threshold(settings_data.threshold)?;
        settings.set_members(settings_data.members.clone())?;
        settings.set_latest_slot_number(settings_data.latest_slot_number)?;
        settings.multi_wallet_bump = settings_data.multi_wallet_bump;
        settings.bump = ctx.bumps.settings;
        settings.index = settings_data.index;
        settings.settings_address_tree_index = settings_data.settings_address_tree_index;

        let mut slot_numbers = Vec::with_capacity(secp256r1_verify_args.len());
        slot_numbers.extend(
            secp256r1_verify_args
                .iter()
                .map(|f| f.verify_args.slot_number),
        );
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;
        settings.invariant()?;

        settings_account.data = None;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

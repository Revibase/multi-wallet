use crate::{
    error::MultisigError, state::{invoke_light_system_program_with_payer_seeds, CompressedSettings, DomainConfig, MemberKey, Permission, ProofArgs, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings, SettingsCloseArgs, TransactionActionType, SEED_MULTISIG, SEED_VAULT}, utils::durable_nonce_check, LIGHT_CPI_SIGNER
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{CpiAccounts, CpiInputs}
};
use std::vec;

#[derive(Accounts)]
#[instruction(settings_close_args: SettingsCloseArgs)]
pub struct DecompressSettingsAccount<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(settings_close_args.data.members.len()), 
        seeds = [
            SEED_MULTISIG,  
            settings_close_args.data.index.to_le_bytes().as_ref()
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
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> DecompressSettingsAccount<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings: &CompressedSettings,
        settings_key: &Pubkey,
    ) -> Result<()> {
        let Self {
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            payer,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let threshold = settings.threshold as usize;
        let secp256r1_member_key = if secp256r1_verify_args.is_some() {
            Some(MemberKey::convert_secp256r1(
                &secp256r1_verify_args.as_ref().unwrap().public_key,
            )?)
        } else {
            None
        };

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);

            let is_secp256r1_signer =
                secp256r1_member_key.is_some() && member.pubkey.eq(&secp256r1_member_key.unwrap());
            let is_signer = is_secp256r1_signer
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

            if is_secp256r1_signer {
                let expected_domain_config = member
                    .domain_config
                    .ok_or(MultisigError::DomainConfigIsMissing)?;

                require!(
                    domain_config.is_some()
                        && domain_config
                            .as_ref()
                            .unwrap()
                            .key()
                            .eq(&expected_domain_config),
                    MultisigError::MemberDoesNotBelongToDomainConfig
                );

            
                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                Secp256r1Pubkey::verify_webauthn(
                    secp256r1_verify_data,
                    slot_hash_sysvar,
                    domain_config,
                    &settings_key,
                    &payer.key().to_bytes(),
                    TransactionActionType::Decompress,
                    &Some(instructions_sysvar.clone()),
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

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        settings_close_args: SettingsCloseArgs,
        compressed_proof_args: ProofArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let settings_key =&ctx.accounts.settings.key();
        ctx.accounts.validate(
            ctx.remaining_accounts,
            &secp256r1_verify_args,
            &settings_close_args.data,
            settings_key,
        )?;

        let settings = &mut ctx.accounts.settings;
        settings.set_threshold(settings_close_args.data.threshold);
        settings.multi_wallet_bump =  settings_close_args.data.multi_wallet_bump;
        settings.bump = ctx.bumps.settings;
        settings.index =  settings_close_args.data.index;
        settings.members = settings_close_args.data.members.clone();
        settings.invariant()?;

        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.payer.as_ref(),
            &ctx.remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let settings_info = CompressedSettings::close_settings_account(settings_close_args)?;

        let cpi_inputs = CpiInputs::new(
            compressed_proof_args.proof,
            vec![settings_info],
        );
        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];
        invoke_light_system_program_with_payer_seeds(cpi_inputs, light_cpi_accounts, vault_signer_seed)?;
        Ok(())
    }
}

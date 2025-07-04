use crate::{
    error::MultisigError,
    state::{
        invoke_light_system_program_with_payer_seeds, CompressedSettings, DomainConfig, MemberKey,
        Permission, ProofArgs, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        SettingsCreationArgs, TransactionActionType, SEED_MULTISIG, SEED_VAULT,
    },
    utils::durable_nonce_check,
    LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{CpiAccounts, CpiInputs};
use std::vec;

#[derive(Accounts)]
pub struct CompressSettingsAccount<'info> {
    #[account(
        mut,
        close = payer,
    )]
    pub settings: Account<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
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

impl<'info> CompressSettingsAccount<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings: &Settings,
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
                    TransactionActionType::Compress,
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
        compressed_proof_args: ProofArgs,
        settings_creation_args: SettingsCreationArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let settings = &ctx.accounts.settings;
        let settings_data = settings.clone().into_inner();
        let settings_key = &ctx.accounts.settings.key();
        ctx.accounts.validate(
            ctx.remaining_accounts,
            &secp256r1_verify_args,
            &settings_data,
            settings_key,
        )?;
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );
        let (settings_info, settings_new_address) = CompressedSettings::create_settings_account(
            settings_creation_args,
            settings_data,
            &light_cpi_accounts,
        )?;

        let cpi = CpiInputs::new_with_address(
            compressed_proof_args.proof,
            vec![settings_info],
            vec![settings_new_address],
        );

        let settings_key = settings.key();
        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];
        invoke_light_system_program_with_payer_seeds(cpi, light_cpi_accounts, vault_signer_seed)?;
        Ok(())
    }
}

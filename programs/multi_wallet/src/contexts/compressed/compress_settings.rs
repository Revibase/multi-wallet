use crate::{
    error::MultisigError,
    state::{
        ChallengeArgs, CompressedSettings, CompressedSettingsData, DomainConfig, MemberKey,
        MultisigSettings, Permission, ProofArgs, Secp256r1VerifyArgs, Settings,
        SettingsCreateOrMutateArgs, TransactionActionType,
    },
    utils::durable_nonce_check,
    LIGHT_CPI_SIGNER,
};
use anchor_lang::{
    prelude::*,
    solana_program::{hash, sysvar::SysvarId},
};
use light_sdk::{
    account::LightAccount,
    cpi::{CpiAccounts, CpiInputs},
};
use std::vec;

#[derive(Accounts)]
pub struct CompressSettingsAccount<'info> {
    #[account(
        mut,
        close = payer,
    )]
    pub settings: AccountLoader<'info, Settings>,
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
    ) -> Result<()> {
        let Self {
            settings,
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

        let settings_data = settings.load()?;
        let threshold = settings_data.threshold as usize;
        let secp256r1_member_key =
            MemberKey::get_signer(&None, secp256r1_verify_args, Some(instructions_sysvar))
                .map_or(None, |f| Some(f));

        for member in &settings_data.members {
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
                require!(
                    member.domain_config.ne(&Pubkey::default()),
                    MultisigError::DomainConfigIsMissing
                );

                require!(
                    domain_config.is_some()
                        && domain_config
                            .as_ref()
                            .unwrap()
                            .key()
                            .eq(&member.domain_config),
                    MultisigError::MemberDoesNotBelongToDomainConfig
                );

                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                secp256r1_verify_data.verify_webauthn(
                    slot_hash_sysvar,
                    domain_config,
                    instructions_sysvar,
                    ChallengeArgs {
                        account: settings.key(),
                        message_hash: hash::hash(&payer.key().to_bytes()).to_bytes(),
                        action_type: TransactionActionType::Compress,
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

    #[access_control(ctx.accounts.validate(&ctx.remaining_accounts, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        settings_args: SettingsCreateOrMutateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let settings_data = ctx.accounts.settings.load()?;
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        match settings_args {
            SettingsCreateOrMutateArgs::Create(settings_creation_args) => {
                let data = CompressedSettingsData {
                    threshold: settings_data.get_threshold()?,
                    bump: settings_data.bump,
                    index: settings_data.index,
                    multi_wallet_bump: settings_data.multi_wallet_bump,
                    members: CompressedSettings::convert_member_to_compressed_member(
                        settings_data.get_members()?,
                    )?,
                };
                let (settings_info, settings_new_address) =
                    CompressedSettings::create_settings_account(
                        settings_creation_args,
                        data,
                        &light_cpi_accounts,
                    )?;

                let cpi_inputs = CpiInputs::new_with_address(
                    compressed_proof_args.proof,
                    vec![settings_info],
                    vec![settings_new_address],
                );

                cpi_inputs
                    .invoke_light_system_program(light_cpi_accounts)
                    .unwrap();
            }
            SettingsCreateOrMutateArgs::Mutate(settings_mut_args) => {
                let mut settings_account = LightAccount::<'_, CompressedSettings>::new_mut(
                    &crate::ID,
                    &settings_mut_args.account_meta,
                    settings_mut_args.data,
                )
                .map_err(ProgramError::from)?;

                settings_account.data = Some(CompressedSettingsData {
                    threshold: settings_data.get_threshold()?,
                    bump: settings_data.bump,
                    index: settings_data.index,
                    multi_wallet_bump: settings_data.multi_wallet_bump,
                    members: CompressedSettings::convert_member_to_compressed_member(
                        settings_data.get_members()?,
                    )?,
                });

                let settings_info = settings_account
                    .to_account_info()
                    .map_err(ProgramError::from)?;

                let cpi_inputs = CpiInputs::new(compressed_proof_args.proof, vec![settings_info]);

                cpi_inputs
                    .invoke_light_system_program(light_cpi_accounts)
                    .unwrap();
            }
        };

        Ok(())
    }
}

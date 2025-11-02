use crate::{
    durable_nonce_check, ChallengeArgs, CompressedSettings, CompressedSettingsData, DomainConfig,
    MemberKey, MultisigError, MultisigSettings, Permission, ProofArgs,
    Secp256r1VerifyArgsWithDomainAddress, Settings, SettingsCreateOrMutateArgs,
    TransactionActionType, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{v2::LightSystemProgramCpi, InvokeLightSystemProgram, LightCpiInstruction};
use light_sdk::instruction::ValidityProof;
use light_sdk::light_hasher::{Hasher, Sha256};
use light_sdk::{account::LightAccount, cpi::v2::CpiAccounts};
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
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> CompressSettingsAccount<'info> {
    fn validate(
        &self,
        remaining_accounts: &'info [AccountInfo<'info>],
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
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

        let settings_data = settings.load()?;
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
                        && MemberKey::convert_ed25519(&account.key())
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
                        message_hash: Sha256::hash(&payer.key().to_bytes()).unwrap(),
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
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
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
                    members: settings_data.get_members()?,
                };
                let (settings_account, settings_new_address) =
                    CompressedSettings::create_compressed_settings_account(
                        settings_creation_args,
                        data,
                        &light_cpi_accounts,
                        Some(0),
                    )?;

                settings_account.invariant()?;

                LightSystemProgramCpi::new_cpi(
                    LIGHT_CPI_SIGNER,
                    ValidityProof(compressed_proof_args.proof),
                )
                .with_light_account(settings_account)?
                .with_new_addresses(&[settings_new_address])
                .invoke(light_cpi_accounts)?;
            }
            SettingsCreateOrMutateArgs::Mutate(settings_mut_args) => {
                let mut settings_account = LightAccount::<CompressedSettings>::new_mut(
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
                    members: settings_data.get_members()?,
                });

                settings_account.invariant()?;

                LightSystemProgramCpi::new_cpi(
                    LIGHT_CPI_SIGNER,
                    ValidityProof(compressed_proof_args.proof),
                )
                .with_light_account(settings_account)?
                .invoke(light_cpi_accounts)?;
            }
        };

        Ok(())
    }
}

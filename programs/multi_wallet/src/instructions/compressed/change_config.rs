use crate::{
    error::MultisigError,
    state::{
        CompressedSettings, CompressedSettingsData, DomainConfig, ProofArgs, Settings,
        UserWalletOperation,
        SettingsIndexWithAddress, SettingsMutArgs, User,
    },
    utils::{
        durable_nonce_check, ChallengeArgs, MemberKey, Permission,
        Secp256r1VerifyArgsWithDomainAddress, TransactionActionType,
    },
    ConfigAction, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    account::LightAccount,
    cpi::v2::CpiAccounts,
    light_hasher::{Hasher, Sha256},
};
use light_sdk::{
    cpi::{v2::LightSystemProgramCpi, InvokeLightSystemProgram, LightCpiInstruction},
    instruction::ValidityProof,
};
use std::vec;

#[derive(Accounts)]
pub struct ChangeConfigCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
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

impl<'info> ChangeConfigCompressed<'info> {
    fn validate(
        &self,
        remaining_accounts: &'info [AccountInfo<'info>],
        config_actions: &Vec<ConfigAction>,
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings: &CompressedSettingsData,
        settings_key: &Pubkey,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let secp256r1_member_keys: Vec<(MemberKey, &Secp256r1VerifyArgsWithDomainAddress)> =
            secp256r1_verify_args
                .iter()
                .filter_map(|arg| {
                    let pubkey = arg
                        .verify_args
                        .extract_public_key_from_instruction(Some(&instructions_sysvar))
                        .ok()?;

                    let member_key = MemberKey::convert_secp256r1(&pubkey).ok()?;

                    Some((member_key, arg))
                })
                .collect();

        for member in &settings.members {
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

                let mut writer = Vec::new();
                config_actions.serialize(&mut writer)?;
                let message_hash =
                    Sha256::hash(&writer).map_err(|_| MultisigError::HashComputationFailed)?;

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: *settings_key,
                        message_hash,
                        action_type: TransactionActionType::ChangeConfig,
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
            vote_count >= settings.threshold,
            MultisigError::InsufficientSignersWithVotePermission
        );

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        config_actions: Vec<ConfigAction>,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let mut settings: LightAccount<CompressedSettings> =
            LightAccount::<CompressedSettings>::new_mut(
                &crate::ID,
                &settings_mut_args.account_meta,
                settings_mut_args.data,
            )
            .map_err(ProgramError::from)?;

        let settings_data = settings
            .data
            .as_ref()
            .ok_or(MultisigError::MissingSettingsData)?;

        let settings_index = settings_data.index;
        let settings_address_tree_index = settings_data.settings_address_tree_index;
        let settings_key =
            Settings::get_settings_key_from_index(settings_index, settings_data.bump)?;

        ctx.accounts.validate(
            ctx.remaining_accounts,
            &config_actions,
            &secp256r1_verify_args,
            &settings_data,
            &settings_key,
        )?;

        let payer: &Signer<'info> = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let mut wallet_operations: Vec<UserWalletOperation> = vec![];

        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    settings.edit_permissions(members)?;
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(members)?;
                    wallet_operations.extend(ops.into_iter().map(UserWalletOperation::Add));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    wallet_operations.extend(ops.into_iter().map(UserWalletOperation::Remove));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold)?;
                }
            }
        }

        let mut slot_numbers = Vec::with_capacity(secp256r1_verify_args.len());
        slot_numbers.extend(
            secp256r1_verify_args
                .iter()
                .map(|f| f.verify_args.slot_number),
        );
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        let start_index = compressed_proof_args.light_cpi_accounts_start_index as usize;
        require!(
            start_index <= remaining_accounts.len(),
            MultisigError::InvalidNumberOfAccounts
        );
        let light_cpi_accounts =
            CpiAccounts::new(&payer, &remaining_accounts[start_index..], LIGHT_CPI_SIGNER);

        let account_infos = User::process_user_wallet_operations(
            wallet_operations,
            SettingsIndexWithAddress {
                index: settings_index,
                settings_address_tree_index,
            },
            &light_cpi_accounts,
        )?;

        let mut cpi = LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings)?;

        for user_account in account_infos {
            user_account.invariant()?;
            cpi = cpi.with_light_account(user_account)?;
        }

        cpi.invoke(light_cpi_accounts)?;

        Ok(())
    }
}

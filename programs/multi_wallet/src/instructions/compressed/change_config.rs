use crate::{
    error::MultisigError,
    state::{
        CompressedSettings, CompressedSettingsData, ProofArgs, Settings, SettingsIndexWithAddress,
        SettingsMutArgs, User, UserWalletOperation,
    },
    utils::TransactionActionType,
    utils::TransactionSyncSigners,
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
        signers: &[TransactionSyncSigners],
        settings: &CompressedSettingsData,
        settings_key: &Pubkey,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = &self;

        let mut writer = Vec::new();
        config_actions.serialize(&mut writer)?;
        let message_hash =
            Sha256::hash(&writer).map_err(|_| MultisigError::HashComputationFailed)?;

        TransactionSyncSigners::verify(
            signers,
            remaining_accounts,
            instructions_sysvar,
            slot_hash_sysvar,
            &settings.members,
            settings.threshold,
            *settings_key,
            message_hash,
            TransactionActionType::ChangeConfig,
        )?;

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        config_actions: Vec<ConfigAction>,
        signers: Vec<TransactionSyncSigners>,
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
            Settings::get_settings_key_from_index_with_bump(settings_index, settings_data.bump)?;

        ctx.accounts.validate(
            ctx.remaining_accounts,
            &config_actions,
            &signers,
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

        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
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

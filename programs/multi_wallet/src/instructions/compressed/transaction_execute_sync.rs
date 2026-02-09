use crate::{
    id,
    state::{Settings, SettingsMutArgs},
    utils::TransactionSyncSigners,
    CompressedSettings, CompressedSettingsData, ExecutableTransactionMessage, MultisigError,
    ProofArgs, TransactionActionType, TransactionMessage, LIGHT_CPI_SIGNER, SEED_MULTISIG,
    SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
    LightAccount,
};

#[derive(Accounts)]
pub struct TransactionExecuteSyncCompressed<'info> {
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

impl<'info> TransactionExecuteSyncCompressed<'info> {
    fn validate(
        &self,
        remaining_accounts: &'info [AccountInfo<'info>],
        transaction_message: &TransactionMessage,
        signers: &[TransactionSyncSigners],
        settings: &CompressedSettingsData,
        settings_key: &Pubkey,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = &self;

        let vault_transaction_message =
            transaction_message.convert_to_vault_transaction_message(remaining_accounts)?;
        let mut writer = Vec::new();
        vault_transaction_message.serialize(&mut writer)?;
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
            TransactionActionType::Sync,
        )?;

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, TransactionExecuteSyncCompressed<'info>>,
        transaction_message: TransactionMessage,
        signers: Vec<TransactionSyncSigners>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let vault_transaction_message =
            transaction_message.convert_to_vault_transaction_message(ctx.remaining_accounts)?;
        vault_transaction_message.validate()?;
        let num_lookups = vault_transaction_message.address_table_lookups.len();
        let message_end_index = num_lookups + vault_transaction_message.num_all_account_keys();

        let address_lookup_table_account_infos = ctx
            .remaining_accounts
            .get(..num_lookups)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?;

        let message_account_infos = ctx
            .remaining_accounts
            .get(num_lookups..message_end_index)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?;

        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
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

        let settings_key = Settings::get_settings_key_from_index_with_bump(
            settings_data.index,
            settings_data.bump,
        )?;

        ctx.accounts.validate(
            ctx.remaining_accounts,
            &transaction_message,
            &signers,
            &settings_data,
            &settings_key,
        )?;

        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings_data.multi_wallet_bump],
        ];

        let vault_pubkey =
            Pubkey::create_program_address(vault_signer_seed, &id()).map_err(ProgramError::from)?;

        let executable_message = ExecutableTransactionMessage::new_validated(
            vault_transaction_message,
            message_account_infos,
            address_lookup_table_account_infos,
            &vault_pubkey,
        )?;

        let protected_accounts = &[ctx.accounts.payer.key()];

        executable_message.execute_message(vault_signer_seed, protected_accounts)?;

        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings_account.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings_account.invariant()?;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

use crate::{
    id,
    state::Settings,
    utils::{MultisigSettings, TransactionSyncSigners},
    ExecutableTransactionMessage, MultisigError, TransactionActionType, TransactionMessage,
    SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::light_hasher::{Hasher, Sha256};

#[derive(Accounts)]
pub struct TransactionExecuteSync<'info> {
    #[account(mut)]
    pub settings: Account<'info, Settings>,
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

impl<'info> TransactionExecuteSync<'info> {
    fn validate(
        &self,
        ctx: &Context<'_, '_, 'info, 'info, Self>,
        transaction_message: &TransactionMessage,
        signers: &Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let Self {
            settings,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        let remaining_accounts = ctx.remaining_accounts;
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
            settings.get_members()?,
            settings.get_threshold()?,
            ctx.accounts.settings.key(),
            message_hash,
            TransactionActionType::Sync,
        )?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &transaction_message, &signers))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        transaction_message: TransactionMessage,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
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

        let settings_key = settings.key();
        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

        let vault_pubkey =
            Pubkey::create_program_address(vault_signer_seed, &id()).map_err(ProgramError::from)?;

        let executable_message = ExecutableTransactionMessage::new_validated(
            vault_transaction_message,
            message_account_infos,
            address_lookup_table_account_infos,
            &vault_pubkey,
        )?;

        let protected_accounts = &[];

        executable_message.execute_message(vault_signer_seed, protected_accounts)?;

        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        Ok(())
    }
}

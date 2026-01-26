use crate::{
    id,
    utils::{SEED_MULTISIG, SEED_VAULT},
    ExecutableTransactionMessage, MultisigError, TransactionBuffer, VaultTransactionMessage,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct TransactionExecuteCompressed<'info> {
    /// CHECK:
    #[account(
        mut,
        constraint = payer.key() == transaction_buffer.payer @MultisigError::PayerMismatch
    )]
    pub payer: UncheckedAccount<'info>,
    #[account(
        mut,
        close = payer,
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl<'info> TransactionExecuteCompressed<'info> {
    fn validate(&self) -> Result<()> {
        let Self {
            transaction_buffer, ..
        } = self;

        require!(
            transaction_buffer.can_execute,
            MultisigError::TransactionNotApproved
        );

        require!(
            Clock::get()?.unix_timestamp as u64 <= transaction_buffer.valid_till,
            MultisigError::TransactionHasExpired
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn process(ctx: Context<'_, '_, '_, 'info, Self>, settings_key: Pubkey) -> Result<()> {
        let transaction_buffer = &ctx.accounts.transaction_buffer;
        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::SettingsKeyMismatch
        );
        let vault_transaction_message =
            VaultTransactionMessage::deserialize(&mut transaction_buffer.buffer.as_slice())?;
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

        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            transaction_buffer.multi_wallet_settings.as_ref(),
            SEED_VAULT,
            &[transaction_buffer.multi_wallet_bump],
        ];

        let vault_pubkey =
            Pubkey::create_program_address(vault_signer_seed, &id()).map_err(ProgramError::from)?;

        let executable_message = ExecutableTransactionMessage::new_validated(
            vault_transaction_message,
            message_account_infos,
            address_lookup_table_account_infos,
            &vault_pubkey,
        )?;

        let protected_accounts = &[transaction_buffer.key(), transaction_buffer.payer];

        executable_message.execute_message(vault_signer_seed, protected_accounts)?;

        Ok(())
    }
}

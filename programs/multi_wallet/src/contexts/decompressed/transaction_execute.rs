use crate::{
    id,
    state::{Settings, SEED_MULTISIG},
    ExecutableTransactionMessage, MultisigError, TransactionBuffer, VaultTransactionMessage,
    SEED_VAULT,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct TransactionExecute<'info> {
    #[account(
        mut,
        address = transaction_buffer.multi_wallet_settings
    )]
    pub settings: AccountLoader<'info, Settings>,
    /// CHECK:
    #[account(
        mut,
        constraint = payer.key() == transaction_buffer.payer @MultisigError::InvalidAccount
    )]
    pub payer: UncheckedAccount<'info>,
    #[account(
        mut,
        close = payer,
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl<'info> TransactionExecute<'info> {
    fn validate(&self) -> Result<()> {
        let Self {
            transaction_buffer, ..
        } = self;

        require!(
            transaction_buffer.can_execute,
            MultisigError::TransactionNotApproved
        );

        require!(
            Clock::get().unwrap().unix_timestamp as u64 <= transaction_buffer.valid_till,
            MultisigError::TransactionHasExpired
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn process(ctx: Context<'_, '_, '_, 'info, Self>) -> Result<()> {
        let transaction_buffer = &ctx.accounts.transaction_buffer;
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

        let protected_accounts = &[transaction_buffer.key()];

        executable_message.execute_message(
            vault_signer_seed,
            protected_accounts,
            Some(transaction_buffer.payer),
        )?;

        Ok(())
    }
}

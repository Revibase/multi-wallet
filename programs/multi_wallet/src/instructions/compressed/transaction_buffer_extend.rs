use crate::{MultisigError, TransactionBuffer};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct TransactionBufferExtendCompressed<'info> {
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl<'info> TransactionBufferExtendCompressed<'info> {
    fn validate(&self, buffer: &[u8], settings_key: &Pubkey) -> Result<()> {
        require!(
            settings_key.eq(&self.transaction_buffer.multi_wallet_settings),
            MultisigError::SettingsKeyMismatch
        );
        self.transaction_buffer.validate_extend_chunk(buffer)
    }

    #[access_control(ctx.accounts.validate(&buffer, &settings_key))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        buffer: Vec<u8>,
        settings_key: Pubkey,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        transaction_buffer.buffer.extend_from_slice(&buffer);

        // Remove the first hash that was just consumed
        if !transaction_buffer.buffer_extend_hashes.is_empty() {
            transaction_buffer.buffer_extend_hashes.remove(0);
        }

        transaction_buffer.invariant()?;

        Ok(())
    }
}

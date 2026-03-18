use crate::{state::Settings, TransactionBuffer};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct TransactionBufferExtend<'info> {
    #[account(
        address = transaction_buffer.multi_wallet_settings
    )]
    pub settings: Account<'info, Settings>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl TransactionBufferExtend<'_> {
    fn validate(&self, buffer: &Vec<u8>) -> Result<()> {
        self.transaction_buffer.validate_extend_chunk(buffer)
    }

    #[access_control(ctx.accounts.validate(&buffer))]
    pub fn process(ctx: Context<Self>, buffer: Vec<u8>) -> Result<()> {
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

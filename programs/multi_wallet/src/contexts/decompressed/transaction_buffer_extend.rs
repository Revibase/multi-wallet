use crate::{state::Settings, MultisigError, TransactionBuffer};
use anchor_lang::{prelude::*, solana_program::hash::hash};

#[derive(Accounts)]
pub struct TransactionBufferExtend<'info> {
    #[account(
        address = transaction_buffer.multi_wallet_settings
    )]
    pub settings: AccountLoader<'info, Settings>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl TransactionBufferExtend<'_> {
    fn validate(&self, buffer: &Vec<u8>) -> Result<()> {
        let Self {
            transaction_buffer, ..
        } = self;

        let current_buffer_size = transaction_buffer.buffer.len() as u16;
        let remaining_space = transaction_buffer
            .final_buffer_size
            .checked_sub(current_buffer_size)
            .ok_or(MultisigError::FinalBufferSizeExceeded)?;

        let new_data_size = buffer.len() as u16;
        require!(
            new_data_size <= remaining_space,
            MultisigError::FinalBufferSizeExceeded
        );

        let required_buffer_hash = transaction_buffer
            .buffer_extend_hashes
            .get(0)
            .ok_or(MultisigError::InvalidBuffer)?;

        let current_buffer_hash = hash(&buffer).to_bytes();

        require!(
            required_buffer_hash.eq(&current_buffer_hash),
            MultisigError::InvalidBuffer
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&buffer))]
    pub fn process(ctx: Context<Self>, buffer: Vec<u8>) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        transaction_buffer.buffer.extend_from_slice(&buffer);

        transaction_buffer.buffer_extend_hashes =
            transaction_buffer.buffer_extend_hashes[1..].to_vec();

        transaction_buffer.invariant()?;

        Ok(())
    }
}

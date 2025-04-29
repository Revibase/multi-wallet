use crate::{MultisigError, TransactionBuffer};
use anchor_lang::{prelude::*, solana_program::hash::hash};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TransactionBufferExtendArgs {
    // Buffer to extend the TransactionBuffer with.
    pub buffer: Vec<u8>,
}

#[derive(Accounts)]
pub struct TransactionBufferExtend<'info> {
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl TransactionBufferExtend<'_> {
    fn validate(&self, args: &TransactionBufferExtendArgs) -> Result<()> {
        let Self {
            transaction_buffer, ..
        } = self;

        // Extended Buffer size must not exceed final buffer size
        // Calculate remaining space in the buffer
        let current_buffer_size = transaction_buffer.buffer.len() as u16;
        let remaining_space = transaction_buffer
            .final_buffer_size
            .checked_sub(current_buffer_size)
            .unwrap();

        // Check if the new data exceeds the remaining space
        let new_data_size = args.buffer.len() as u16;
        require!(
            new_data_size <= remaining_space,
            MultisigError::FinalBufferSizeExceeded
        );

        let required_buffer_hash = transaction_buffer
            .buffer_extend_hashes
            .get(0)
            .ok_or(MultisigError::InvalidBuffer)?;

        let current_buffer_hash = hash(&args.buffer).to_bytes();

        require!(
            required_buffer_hash.eq(&current_buffer_hash),
            MultisigError::InvalidBuffer
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&args))]
    pub fn process(ctx: Context<Self>, args: TransactionBufferExtendArgs) -> Result<()> {
        // Mutable Accounts
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        // Extend the Buffer inside the TransactionBuffer
        transaction_buffer.buffer.extend_from_slice(&args.buffer);

        // Pop the first buffer extend hash
        transaction_buffer.buffer_extend_hashes =
            transaction_buffer.buffer_extend_hashes[1..].to_vec();

        // Invariant function on the transaction buffer
        transaction_buffer.invariant()?;

        Ok(())
    }
}

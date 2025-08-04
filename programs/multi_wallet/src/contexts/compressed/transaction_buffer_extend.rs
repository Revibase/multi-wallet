use crate::{MultisigError, TransactionBuffer};
use anchor_lang::{prelude::*, solana_program::hash::hash};

#[derive(Accounts)]
pub struct TransactionBufferExtendCompressed<'info> {
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl<'info> TransactionBufferExtendCompressed<'info> {
    fn validate(&self, buffer: &Vec<u8>, settings_key: &Pubkey) -> Result<()> {
        let Self {
            transaction_buffer, ..
        } = self;
        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::InvalidArguments
        );
        let current_buffer_size = transaction_buffer.buffer.len() as u16;
        let remaining_space = transaction_buffer
            .final_buffer_size
            .checked_sub(current_buffer_size)
            .unwrap();

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

    #[access_control(ctx.accounts.validate(&buffer, &settings_key))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        buffer: Vec<u8>,
        settings_key: Pubkey,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        transaction_buffer.buffer.extend_from_slice(&buffer);

        transaction_buffer.buffer_extend_hashes =
            transaction_buffer.buffer_extend_hashes[1..].to_vec();

        transaction_buffer.invariant()?;

        Ok(())
    }
}

use crate::{MultisigError, TransactionBuffer};
use anchor_lang::prelude::*;
use light_sdk::light_hasher::{Hasher, Sha256};

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
            MultisigError::SettingsKeyMismatch
        );
        let current_buffer_size = u16::try_from(transaction_buffer.buffer.len())
            .map_err(|_| MultisigError::FinalBufferSizeExceeded)?;
        let remaining_space = transaction_buffer
            .final_buffer_size
            .checked_sub(current_buffer_size)
            .ok_or(MultisigError::FinalBufferSizeExceeded)?;

        let new_data_size = u16::try_from(buffer.len())
            .map_err(|_| MultisigError::FinalBufferSizeExceeded)?;
        require!(
            new_data_size <= remaining_space,
            MultisigError::FinalBufferSizeExceeded
        );

        let required_buffer_hash = transaction_buffer
            .buffer_extend_hashes
            .get(0)
            .ok_or(MultisigError::InvalidBuffer)?;

        let current_buffer_hash = Sha256::hash(&buffer)
            .map_err(|_| MultisigError::HashComputationFailed)?;

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

        // Remove the first hash that was just consumed
        if !transaction_buffer.buffer_extend_hashes.is_empty() {
            transaction_buffer.buffer_extend_hashes.remove(0);
        }

        transaction_buffer.invariant()?;

        Ok(())
    }
}

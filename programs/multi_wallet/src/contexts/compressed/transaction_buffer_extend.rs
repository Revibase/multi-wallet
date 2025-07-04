use crate::{
    state::{verify_compressed_settings, ProofArgs, SettingsProofArgs},
    MultisigError, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::hash::hash};

#[derive(Accounts)]
pub struct TransactionBufferExtendCompressed<'info> {
    #[account(
        mut,
        address = transaction_buffer.payer
    )]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
}

impl<'info> TransactionBufferExtendCompressed<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
        buffer: &Vec<u8>,
        settings_args: &SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let Self {
            transaction_buffer,
            payer,
            ..
        } = self;
        let (_, settings_key) = verify_compressed_settings(
            &payer.to_account_info(),
            None,
            &settings_args,
            &remaining_accounts,
            compressed_proof_args,
        )?;
        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::InvalidAccount
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

    #[access_control(ctx.accounts.validate(&ctx.remaining_accounts, &buffer, &settings_args, compressed_proof_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        buffer: Vec<u8>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        transaction_buffer.buffer.extend_from_slice(&buffer);

        transaction_buffer.buffer_extend_hashes =
            transaction_buffer.buffer_extend_hashes[1..].to_vec();

        transaction_buffer.invariant()?;

        Ok(())
    }
}

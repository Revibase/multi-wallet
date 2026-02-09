use crate::{
    utils::TransactionBufferSigners, DomainConfig, MultisigError, Secp256r1VerifyArgs, Settings,
    TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferClose<'info> {
    #[account(
        mut,
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: Account<'info, Settings>,
    /// CHECK:
    #[account(
            mut,
            constraint = payer.key() == transaction_buffer.payer @MultisigError::PayerMismatch
        )]
    pub payer: UncheckedAccount<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        mut,
        close = payer,
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
    pub closer: Option<Signer<'info>>,
    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl TransactionBufferClose<'_> {
    fn validate(&mut self, secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Result<()> {
        let Self {
            closer,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            settings,
            ..
        } = self;
        TransactionBufferSigners::verify_close(
            closer,
            secp256r1_verify_args,
            instructions_sysvar,
            slot_hash_sysvar,
            domain_config,
            &transaction_buffer.creator,
            &transaction_buffer.payer,
            transaction_buffer.multi_wallet_settings,
            transaction_buffer.final_buffer_hash,
            transaction_buffer.valid_till,
        )?;

        let slot_numbers = TransactionBufferSigners::collect_slot_numbers(&secp256r1_verify_args);
        settings.latest_slot_number_check(&slot_numbers, &slot_hash_sysvar)?;
        settings.invariant()?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        Ok(())
    }
}

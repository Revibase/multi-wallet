use crate::{
    utils::{MultisigSettings, TransactionBufferSigners},
    DomainConfig, MemberKey, Secp256r1VerifyArgs, Settings, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferVote<'info> {
    #[account(
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: Account<'info, Settings>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
    pub voter: Option<Signer<'info>>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl TransactionBufferVote<'_> {
    fn validate(&self, secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Result<()> {
        let Self {
            settings,
            voter,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        transaction_buffer.validate_hash()?;
        transaction_buffer.validate_size()?;

        TransactionBufferSigners::verify_vote(
            voter,
            secp256r1_verify_args,
            instructions_sysvar,
            slot_hash_sysvar,
            domain_config,
            settings.get_members()?,
            transaction_buffer.multi_wallet_settings,
            transaction_buffer.final_buffer_hash,
            &transaction_buffer.expected_signers,
        )?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;
        let voter = &ctx.accounts.voter;
        let signer = MemberKey::get_signer(
            voter,
            &secp256r1_verify_args,
            ctx.accounts.instructions_sysvar.as_ref(),
        )?;

        transaction_buffer.add_voter(&signer)?;

        transaction_buffer.invariant()?;

        Ok(())
    }
}

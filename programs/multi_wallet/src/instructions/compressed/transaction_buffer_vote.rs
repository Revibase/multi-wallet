use crate::utils::TransactionBufferSigners;
use crate::{
    state::SettingsReadonlyArgs, CompressedSettings, DomainConfig, MemberKey, MultisigError,
    ProofArgs, Secp256r1VerifyArgs, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferVoteCompressed<'info> {
    #[account(
        mut,
        address = transaction_buffer.payer
    )]
    pub payer: Signer<'info>,
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

impl<'info> TransactionBufferVoteCompressed<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings_readonly_args: &SettingsReadonlyArgs,
        compressed_proof_args: &ProofArgs,
    ) -> Result<()> {
        let Self {
            voter,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            payer,
            ..
        } = self;

        transaction_buffer.validate_hash()?;
        transaction_buffer.validate_size()?;

        let (settings, settings_key) =
            CompressedSettings::verify_readonly_compressed_settings_account(
                &payer,
                settings_readonly_args,
                &remaining_accounts,
                compressed_proof_args,
            )?;
        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::InvalidAccount
        );

        TransactionBufferSigners::verify_vote(
            voter,
            secp256r1_verify_args,
            instructions_sysvar,
            slot_hash_sysvar,
            domain_config,
            &settings.members,
            transaction_buffer.multi_wallet_settings,
            transaction_buffer.final_buffer_hash,
            transaction_buffer.expected_signers.as_ref(),
        )?;

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_readonly_args: SettingsReadonlyArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        ctx.accounts.validate(
            ctx.remaining_accounts,
            &secp256r1_verify_args,
            &settings_readonly_args,
            &compressed_proof_args,
        )?;
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

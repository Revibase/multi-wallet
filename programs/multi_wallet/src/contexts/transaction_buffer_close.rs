use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionBufferActionType, SEED_DOMAIN_CONFIG, SEED_MULTISIG,
    },
    MultisigError, TransactionBuffer, SEED_TRANSACTION_BUFFER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferClose<'info> {
    #[account(
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: Account<'info, Settings>,

    #[account(
        seeds = [SEED_DOMAIN_CONFIG, domain_config.load()?.rp_id_hash.as_ref()],
        bump = domain_config.load()?.bump,
    )]
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,

    #[account(
        mut,
        close = rent_payer,
        seeds = [
            SEED_MULTISIG,
            transaction_buffer.multi_wallet_settings.as_ref(),
            SEED_TRANSACTION_BUFFER,
            transaction_buffer.creator.get_seed(),
            &transaction_buffer.buffer_index.to_le_bytes()
        ],
        bump = transaction_buffer.bump
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,

    pub closer: Option<Signer<'info>>,

    /// CHECK:
    #[account(
        mut,
        constraint = rent_payer.key() == transaction_buffer.rent_payer @MultisigError::InvalidAccount
    )]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: UncheckedAccount<'info>,
}

impl TransactionBufferClose<'_> {
    fn validate(&self, secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Result<()> {
        let Self {
            closer,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            ..
        } = self;

        let signer = MemberKey::get_signer(closer, secp256r1_verify_args)?;

        // allow rent payer to become the closer after transaction has expired
        if Clock::get().unwrap().unix_timestamp as u64 > transaction_buffer.expiry
            && signer.get_type().eq(&KeyType::Ed25519)
            && MemberKey::convert_ed25519(&transaction_buffer.rent_payer)?.eq(&signer)
        {
            Ok(())
        } else {
            require!(
                transaction_buffer.creator.eq(&signer),
                MultisigError::UnauthorisedToModifyBuffer
            );

            if signer.get_type().eq(&KeyType::Secp256r1) {
                Secp256r1Pubkey::verify_secp256r1(
                    secp256r1_verify_args,
                    &slot_hash_sysvar.to_account_info(),
                    domain_config,
                    &transaction_buffer.key(),
                    &transaction_buffer.final_buffer_hash,
                    TransactionBufferActionType::Close,
                )?;
            }

            Ok(())
        }
    }

    /// Close a transaction buffer account.
    #[access_control(ctx.accounts.validate(secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        Ok(())
    }
}

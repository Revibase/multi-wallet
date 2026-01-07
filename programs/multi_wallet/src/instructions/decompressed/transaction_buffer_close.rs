use crate::{
    ChallengeArgs, DomainConfig, KeyType, MemberKey, MultisigError, Secp256r1VerifyArgs, Settings,
    TransactionActionType, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferClose<'info> {
    #[account(
        mut,
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: AccountLoader<'info, Settings>,
    /// CHECK:
    #[account(
            mut,
            constraint = payer.key() == transaction_buffer.payer @MultisigError::InvalidAccount
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
    fn validate(&self, secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Result<()> {
        let Self {
            closer,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            settings,
            ..
        } = self;
        let settings = &mut settings.load_mut()?;
        let signer =
            MemberKey::get_signer(closer, secp256r1_verify_args, instructions_sysvar.as_ref())?;
        // allow rent payer to become the closer after transaction has expired
        if !(Clock::get().unwrap().unix_timestamp as u64 > transaction_buffer.valid_till
            && signer.get_type().eq(&KeyType::Ed25519)
            && MemberKey::convert_ed25519(&transaction_buffer.payer)?.eq(&signer))
        {
            require!(
                transaction_buffer.creator.eq(&signer),
                MultisigError::UnauthorisedToCloseTransactionBuffer
            );
            if signer.get_type().eq(&KeyType::Secp256r1) {
                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                let instructions_sysvar = instructions_sysvar
                    .as_ref()
                    .ok_or(MultisigError::MissingAccount)?;

                secp256r1_verify_data.verify_webauthn(
                    slot_hash_sysvar,
                    domain_config,
                    instructions_sysvar,
                    ChallengeArgs {
                        account: transaction_buffer.multi_wallet_settings,
                        message_hash: transaction_buffer.final_buffer_hash,
                        action_type: TransactionActionType::Close,
                    },
                    transaction_buffer.expected_secp256r1_signers.as_ref(),
                )?;

                settings.latest_slot_number_check(
                    vec![secp256r1_verify_data.slot_number],
                    slot_hash_sysvar,
                )?;
            }
        }
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

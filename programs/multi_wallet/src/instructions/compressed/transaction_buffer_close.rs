use crate::{
    state::SettingsReadonlyArgs, ChallengeArgs, CompressedSettings, DomainConfig, KeyType,
    MemberKey, MultisigError, ProofArgs, Secp256r1VerifyArgs, TransactionActionType,
    TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferCloseCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    #[account(
        mut,
        address = transaction_buffer.payer
    )]
    pub rent_collector: UncheckedAccount<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        mut,
        close = rent_collector,
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

impl<'info> TransactionBufferCloseCompressed<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings_readonly_args: &SettingsReadonlyArgs,
        compressed_proof_args: &ProofArgs,
    ) -> Result<()> {
        let Self {
            closer,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            payer,
            ..
        } = self;

        let (_, settings_key) = CompressedSettings::verify_compressed_settings_account(
            &payer.to_account_info(),
            settings_readonly_args,
            remaining_accounts,
            compressed_proof_args,
        )?;

        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::InvalidAccount
        );
        let signer =
            MemberKey::get_signer(closer, secp256r1_verify_args, instructions_sysvar.as_ref())?;

        // allow rent payer to become the closer after transaction has expired
        if Clock::get().unwrap().unix_timestamp as u64 > transaction_buffer.valid_till
            && signer.get_type().eq(&KeyType::Ed25519)
            && MemberKey::convert_ed25519(&transaction_buffer.payer)?.eq(&signer)
        {
            Ok(())
        } else {
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
                        account: transaction_buffer.key(),
                        message_hash: transaction_buffer.final_buffer_hash,
                        action_type: TransactionActionType::Close,
                    },
                )?;
            }

            Ok(())
        }
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
        Ok(())
    }
}

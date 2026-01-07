use crate::{
    state::SettingsReadonlyArgs, ChallengeArgs, CompressedSettings, DomainConfig, KeyType,
    MemberKey, MultisigError, Permission, ProofArgs, Secp256r1VerifyArgs, TransactionActionType,
    TransactionBuffer,
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

        let signer =
            MemberKey::get_signer(voter, secp256r1_verify_args, instructions_sysvar.as_ref())?;
        let (settings, settings_key) =
            CompressedSettings::verify_readonly_compressed_settings_account(
                &payer.to_account_info(),
                settings_readonly_args,
                &remaining_accounts,
                compressed_proof_args,
            )?;
        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::InvalidAccount
        );

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        require!(
            member.permissions.has(Permission::VoteTransaction),
            MultisigError::InsufficientSignersWithVotePermission
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
                    action_type: TransactionActionType::Vote,
                },
                transaction_buffer.expected_secp256r1_signers.as_ref(),
            )?;
        }

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

use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionBufferActionType, SEED_DOMAIN_CONFIG, SEED_MULTISIG,
    },
    utils::realloc_if_needed,
    MultisigError, Permission, TransactionBuffer, SEED_TRANSACTION_BUFFER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferVote<'info> {
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
        seeds = [
            SEED_MULTISIG,
            transaction_buffer.multi_wallet_settings.as_ref(),
            SEED_TRANSACTION_BUFFER,
            transaction_buffer.creator.get_seed(),
            transaction_buffer.buffer_index.to_le_bytes().as_ref()
        ],
        bump = transaction_buffer.bump,
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,

    pub voter: Option<Signer<'info>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: UncheckedAccount<'info>,
}

impl TransactionBufferVote<'_> {
    fn validate(&self, secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Result<()> {
        let Self {
            settings,
            voter,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            ..
        } = self;

        transaction_buffer.validate_hash()?;
        transaction_buffer.validate_size()?;

        let signer = MemberKey::get_signer(voter, secp256r1_verify_args)?;

        require!(
            settings
                .members
                .iter()
                .any(|x| x.pubkey.eq(&signer) && x.permissions.has(Permission::VoteTransaction)),
            MultisigError::InsufficientSignersWithVotePermission
        );

        if signer.get_type().eq(&KeyType::Secp256r1) {
            Secp256r1Pubkey::verify_secp256r1(
                secp256r1_verify_args,
                &slot_hash_sysvar.to_account_info(),
                domain_config,
                &transaction_buffer.key(),
                &transaction_buffer.final_buffer_hash,
                TransactionBufferActionType::Vote,
            )?;
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;
        let current_size = transaction_buffer.to_account_info().data.borrow().len();
        let voter = &ctx.accounts.voter;
        let signer = MemberKey::get_signer(voter, secp256r1_verify_args)?;

        transaction_buffer.add_voter(signer);

        realloc_if_needed(
            &transaction_buffer.to_account_info(),
            current_size,
            TransactionBuffer::size(
                transaction_buffer.voters.len() as u8,
                transaction_buffer.final_buffer_size,
            )?,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;

        transaction_buffer.invariant()?;

        Ok(())
    }
}

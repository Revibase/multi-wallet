use crate::utils::TransactionBufferSigners;
use crate::{
    DomainConfig, MemberKey, MultisigError, Permission, Secp256r1VerifyArgs, Settings,
    TransactionBuffer, TransactionBufferCreateArgs, MAX_BUFFER_SIZE, SEED_MULTISIG,
    SEED_TRANSACTION_BUFFER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
#[instruction(args: TransactionBufferCreateArgs, secp256r1_verify_args: Option<Secp256r1VerifyArgs> )]
pub struct TransactionBufferCreate<'info> {
    pub settings: Account<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        init,
        payer = payer,
        space = TransactionBuffer::size(args.final_buffer_size, args.buffer_extend_hashes.len(), args.expected_signers.len())?,
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_TRANSACTION_BUFFER,
            {&MemberKey::get_signer(&creator, &secp256r1_verify_args, Some(&instructions_sysvar))?.get_seed()?},
            args.buffer_index.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
    pub creator: Option<Signer<'info>>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
}

impl TransactionBufferCreate<'_> {
    fn validate(
        &self,
        args: &TransactionBufferCreateArgs,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let Self {
            settings,
            creator,
            domain_config,
            instructions_sysvar,
            slot_hash_sysvar,
            ..
        } = self;

        require!(
            args.final_buffer_size as usize <= MAX_BUFFER_SIZE,
            MultisigError::FinalBufferSizeExceeded
        );

        TransactionBufferSigners::verify_create(
            creator,
            secp256r1_verify_args,
            instructions_sysvar,
            slot_hash_sysvar,
            domain_config,
            &settings.members,
            settings.key(),
            args.final_buffer_hash,
            args.preauthorize_execution,
        )?;

        require!(
            args.expected_signers
                .iter()
                .all(|f| settings.members.iter().any(|x| x.pubkey.eq(&f.member_key))),
            MultisigError::InvalidArguments
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&args, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;
        let settings = &ctx.accounts.settings;
        let signer: MemberKey = MemberKey::get_signer(
            &ctx.accounts.creator,
            &secp256r1_verify_args,
            Some(&ctx.accounts.instructions_sysvar),
        )?;

        transaction_buffer.init(
            ctx.accounts.settings.key(),
            settings.multi_wallet_bump,
            ctx.accounts.payer.key(),
            args,
            ctx.bumps.transaction_buffer,
        )?;

        transaction_buffer.add_initiator(signer)?;

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::InvalidArguments)?;

        if member.permissions.has(Permission::VoteTransaction) {
            transaction_buffer.add_voter(&signer)?;
        }

        transaction_buffer.invariant()?;

        Ok(())
    }
}

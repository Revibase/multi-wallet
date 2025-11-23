use crate::{
    durable_nonce_check, utils::UserRole, ChallengeArgs, DomainConfig, KeyType, MemberKey,
    MultisigError, Permission, Secp256r1VerifyArgs, Settings, TransactionActionType,
    TransactionBuffer, TransactionBufferCreateArgs, MAX_BUFFER_SIZE, SEED_MULTISIG,
    SEED_TRANSACTION_BUFFER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
#[instruction(args: TransactionBufferCreateArgs, secp256r1_verify_args: Option<Secp256r1VerifyArgs> )]
pub struct TransactionBufferCreate<'info> {
    pub settings: AccountLoader<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        init,
        payer = payer,
        space = TransactionBuffer::size(args.final_buffer_size, args.buffer_extend_hashes.len())?,
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
            transaction_buffer,
            instructions_sysvar,
            slot_hash_sysvar,
            ..
        } = self;

        durable_nonce_check(instructions_sysvar)?;

        require!(
            args.final_buffer_size as usize <= MAX_BUFFER_SIZE,
            MultisigError::FinalBufferSizeExceeded
        );

        let signer: MemberKey =
            MemberKey::get_signer(creator, &secp256r1_verify_args, Some(instructions_sysvar))?;
        let settings = settings.load()?;
        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        require!(
            member.permissions.has(Permission::InitiateTransaction),
            MultisigError::InsufficientSignerWithInitiatePermission
        );

        if args.preauthorize_execution {
            require!(
                member.permissions.has(Permission::ExecuteTransaction),
                MultisigError::InsufficientSignerWithExecutePermission
            );
        }

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let secp256r1_verify_data = secp256r1_verify_args
                .as_ref()
                .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            secp256r1_verify_data.verify_webauthn(
                slot_hash_sysvar,
                domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: transaction_buffer.key(),
                    message_hash: args.final_buffer_hash,
                    action_type: if args.preauthorize_execution {
                        TransactionActionType::CreateWithPreauthorizedExecution
                    } else {
                        TransactionActionType::Create
                    },
                },
                None,
            )?;
        }

        if UserRole::from(member.role).eq(&UserRole::TransactionManager) {
            let expected_secp256r1_signers = args
                .expected_secp256r1_signers
                .as_ref()
                .ok_or(MultisigError::InvalidArguments)?;

            require!(
                expected_secp256r1_signers
                    .iter()
                    .all(|f| settings.members.iter().any(|x| f
                        .member_key
                        .get_type()
                        .eq(&KeyType::Secp256r1)
                        && x.pubkey.eq(&f.member_key))),
                MultisigError::InvalidArguments
            );
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&args, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;
        let settings = &ctx.accounts.settings.load()?;
        let signer: MemberKey = MemberKey::get_signer(
            &ctx.accounts.creator,
            &secp256r1_verify_args,
            Some(&ctx.accounts.instructions_sysvar),
        )?;

        transaction_buffer.init(
            ctx.accounts.settings.key(),
            settings.multi_wallet_bump,
            ctx.accounts.payer.key(),
            &args,
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

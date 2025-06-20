use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType, TransactionBufferCreateArgs, SEED_MULTISIG,
    },
    utils::durable_nonce_check,
    MultisigError, Permission, TransactionBuffer, MAX_BUFFER_SIZE, SEED_TRANSACTION_BUFFER,
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
        space = TransactionBuffer::size(settings.threshold, args.final_buffer_size, args.buffer_extend_hashes.len())?,
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_TRANSACTION_BUFFER,
            {&MemberKey::get_signer(&creator, &secp256r1_verify_args)?.get_seed()},
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

        let signer: MemberKey = MemberKey::get_signer(creator, &secp256r1_verify_args)?;

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        require!(
            member.permissions.has(Permission::InitiateTransaction),
            MultisigError::InsufficientSignerWithInitiatePermission
        );

        if args.permissionless_execution {
            require!(
                member.permissions.has(Permission::ExecuteTransaction),
                MultisigError::InsufficientSignerWithExecutePermission
            );
        }

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let expected_domain_config = member
                .domain_config
                .ok_or(MultisigError::DomainConfigIsMissing)?;

            require!(
                domain_config.is_some()
                    && domain_config
                        .as_ref()
                        .unwrap()
                        .key()
                        .eq(&expected_domain_config),
                MultisigError::MemberDoesNotBelongToDomainConfig
            );

            let secp256r1_verify_data = secp256r1_verify_args
                .as_ref()
                .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            Secp256r1Pubkey::verify_webauthn(
                secp256r1_verify_data,
                slot_hash_sysvar,
                domain_config,
                &transaction_buffer.key(),
                &args.final_buffer_hash,
                if args.permissionless_execution {
                    TransactionActionType::CreateWithPermissionlessExecution
                } else {
                    TransactionActionType::Create
                },
                &Some(instructions_sysvar.clone()),
            )?;
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
        let settings = &ctx.accounts.settings;
        let creator = &ctx.accounts.creator;
        let payer = &ctx.accounts.payer;
        let buffer_index = args.buffer_index;
        let signer: MemberKey = MemberKey::get_signer(creator, &secp256r1_verify_args)?;

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        transaction_buffer.init(
            settings.key(),
            settings.multi_wallet_bump,
            member.pubkey,
            payer.key(),
            buffer_index,
            &args,
            ctx.bumps.transaction_buffer,
        )?;

        if member.permissions.has(Permission::VoteTransaction) {
            transaction_buffer.add_voter(&member.pubkey);
        }

        transaction_buffer.invariant()?;

        Ok(())
    }
}

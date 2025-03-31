use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionBufferActionType, SEED_DOMAIN_CONFIG, SEED_MULTISIG,
    },
    MultisigError, Permission, TransactionBuffer, MAX_BUFFER_SIZE, SEED_TRANSACTION_BUFFER,
};
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{instructions, SysvarId},
    system_program,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct TransactionBufferCreateArgs {
    /// Index of the buffer account to seed the account derivation
    pub buffer_index: u8,
    /// Hash of the final assembled transaction message.
    pub final_buffer_hash: [u8; 32],
    /// Final size of the buffer.
    pub final_buffer_size: u16,
    /// Initial slice of the buffer.
    pub buffer: Vec<u8>,
    /// Creator of the transaction
    pub creator: MemberKey,
}

#[derive(Accounts)]
#[instruction(args: TransactionBufferCreateArgs)]
pub struct TransactionBufferCreate<'info> {
    #[account(
        seeds = [SEED_MULTISIG, settings.create_key.as_ref()],
        bump = settings.bump
    )]
    pub settings: Account<'info, Settings>,

    #[account(
        seeds = [SEED_DOMAIN_CONFIG, domain_config.load()?.rp_id_hash.as_ref()],
        bump = domain_config.load()?.bump,
    )]
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,

    #[account(
        init,
        payer = rent_payer,
        space = TransactionBuffer::size(settings.threshold, args.final_buffer_size)?,
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_TRANSACTION_BUFFER,
            args.creator.get_seed(),
            args.buffer_index.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,

    pub creator: Option<Signer<'info>>,

    #[account(mut)]
    pub rent_payer: Signer<'info>,

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
    pub slot_hash_sysvar: UncheckedAccount<'info>,
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

        let ix: anchor_lang::solana_program::instruction::Instruction =
            instructions::load_instruction_at_checked(0, instructions_sysvar)?;

        require!(
            !(ix.program_id == system_program::ID && ix.data.first() == Some(&4)),
            MultisigError::DurableNonceDetected
        );

        require!(
            args.final_buffer_size as usize <= MAX_BUFFER_SIZE,
            MultisigError::FinalBufferSizeExceeded
        );

        let signer = MemberKey::get_signer(creator, secp256r1_verify_args)?;

        require!(
            signer.eq(&args.creator),
            MultisigError::UnauthorisedToModifyBuffer
        );

        require!(
            settings
            .members
            .iter()
            .any(|x| x.pubkey.eq(&signer) && x.permissions.has(Permission::InitiateTransaction)),
            MultisigError::InsufficientSignerWithInitiatePermission
        );

        if signer.get_type().eq(&KeyType::Secp256r1) {
            Secp256r1Pubkey::verify_secp256r1(
                secp256r1_verify_args,
                &slot_hash_sysvar.to_account_info(),
                domain_config,
                &transaction_buffer.key(),
                &transaction_buffer.final_buffer_hash,
                TransactionBufferActionType::Create,
            )?;
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(args, secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        args: &TransactionBufferCreateArgs,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        // Mutable Accounts
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        // Readonly Accounts
        let settings = &ctx.accounts.settings;
        let creator = &ctx.accounts.creator;
        let rent_payer = &ctx.accounts.rent_payer;

        // Get the buffer index.
        let buffer_index = args.buffer_index;
        let signer = settings
            .members
            .iter()
            .find(|f| {
                f.pubkey
                    .eq(&MemberKey::get_signer(creator, secp256r1_verify_args).unwrap())
            })
            .unwrap();

        // Initialize the transaction fields.
        transaction_buffer.multi_wallet_settings = settings.key();
        transaction_buffer.creator = signer.pubkey.clone();
        transaction_buffer.rent_payer = rent_payer.key();
        transaction_buffer.buffer_index = buffer_index;
        transaction_buffer.final_buffer_hash = args.final_buffer_hash;
        transaction_buffer.final_buffer_size = args.final_buffer_size;
        transaction_buffer.buffer = args.buffer.clone();
        transaction_buffer.bump = ctx.bumps.transaction_buffer;
        transaction_buffer.expiry = Clock::get().unwrap().unix_timestamp as u64 + 3 * 60; // transaction only valid for 3 mins
        transaction_buffer.voters = Vec::new();

        // add creator as signer if creator has vote permission
        if signer.permissions.has(Permission::VoteTransaction) {
            transaction_buffer.add_voter(signer.pubkey.clone());
        }

        // Invariant function on the transaction buffer
        transaction_buffer.invariant()?;

        Ok(())
    }
}

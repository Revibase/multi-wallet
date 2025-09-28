use crate::{
    state::{
        ChallengeArgs, CompressedSettings, CompressedSettingsData, DomainConfig, KeyType,
        MemberKey, ProofArgs, Secp256r1VerifyArgs, Settings, SettingsReadonlyArgs,
        TransactionActionType, TransactionBufferCreateArgs, SEED_MULTISIG,
    },
    utils::durable_nonce_check,
    MultisigError, Permission, TransactionBuffer, MAX_BUFFER_SIZE, SEED_TRANSACTION_BUFFER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
#[instruction(args: TransactionBufferCreateArgs, secp256r1_verify_args: Option<Secp256r1VerifyArgs>, settings_readonly: SettingsReadonlyArgs)]
pub struct TransactionBufferCreateCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        init,
        payer = payer,
        space = TransactionBuffer::size(args.final_buffer_size, args.buffer_extend_hashes.len())?,
        seeds = [
            SEED_MULTISIG,
            {
                let settings = settings_readonly.data.data.as_ref().ok_or(MultisigError::InvalidArguments)?;
                Settings::get_settings_key_from_index(settings.index, settings.bump)?.as_ref()
            },
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

impl<'info> TransactionBufferCreateCompressed<'info> {
    fn validate(
        &self,
        args: &TransactionBufferCreateArgs,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings: &CompressedSettingsData,
    ) -> Result<()> {
        let Self {
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
                    action_type: if args.permissionless_execution {
                        TransactionActionType::CreateWithPermissionlessExecution
                    } else {
                        TransactionActionType::Create
                    },
                },
            )?;
        }

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_readonly: SettingsReadonlyArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let creator = &ctx.accounts.creator;
        let payer = &ctx.accounts.payer;
        let buffer_index = args.buffer_index;
        let signer = MemberKey::get_signer(
            creator,
            &secp256r1_verify_args,
            Some(&ctx.accounts.instructions_sysvar),
        )?;

        let (settings, settings_key) = CompressedSettings::verify_compressed_settings(
            &payer.to_account_info(),
            &settings_readonly,
            ctx.remaining_accounts,
            &compressed_proof_args,
        )?;

        ctx.accounts
            .validate(&args, &secp256r1_verify_args, &settings)?;

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        let transaction_buffer = &mut ctx.accounts.transaction_buffer;
        transaction_buffer.init(
            settings_key,
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

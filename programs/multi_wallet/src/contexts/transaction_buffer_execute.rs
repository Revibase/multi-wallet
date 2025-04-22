use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType, SEED_MULTISIG,
    },
    ExecutableTransactionMessage, MultisigError, Permission, TransactionBuffer,
    VaultTransactionMessage, SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferExecute<'info> {
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,

    #[account(
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: Box<Account<'info, Settings>>,
    /// CHECK:
    #[account(
        mut,
        constraint = rent_payer.key() == transaction_buffer.rent_payer @MultisigError::InvalidAccount
    )]
    pub rent_payer: UncheckedAccount<'info>,

    pub executor: Option<Signer<'info>>,

    #[account(
        mut,
        close = rent_payer,
    )]
    pub transaction_buffer: Box<Account<'info, TransactionBuffer>>,

    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
}

impl<'info> TransactionBufferExecute<'info> {
    fn validate(
        &self,
        ctx: &Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let Self {
            settings,
            transaction_buffer,
            executor,
            domain_config,
            slot_hash_sysvar,
            ..
        } = self;
        transaction_buffer.validate_hash()?;
        transaction_buffer.validate_size()?;

        require!(
            Clock::get().unwrap().unix_timestamp as u64 <= ctx.accounts.transaction_buffer.expiry,
            MultisigError::TransactionHasExpired
        );

        let signer = MemberKey::get_signer(executor, secp256r1_verify_args)?;

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        require!(
            member.permissions.has(Permission::InitiateTransaction),
            MultisigError::InsufficientSignerWithExecutePermission
        );

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let metadata = member.metadata.ok_or(MultisigError::MissingMetadata)?;

            require!(
                domain_config.is_some() && domain_config.as_ref().unwrap().key().eq(&metadata),
                MultisigError::MemberDoesNotBelongToDomainConfig
            );

            Secp256r1Pubkey::verify_secp256r1(
                secp256r1_verify_args,
                slot_hash_sysvar,
                domain_config,
                &transaction_buffer.key(),
                &transaction_buffer.final_buffer_hash,
                TransactionActionType::Execute,
            )?;
        }

        // add executor to signers if executor has vote permission
        require!(
            settings
                .members
                .iter()
                .filter(|x| x.permissions.has(Permission::VoteTransaction)
                    && (transaction_buffer.voters.contains(&x.pubkey))
                    || signer.eq(&x.pubkey))
                .count()
                >= settings.threshold as usize,
            MultisigError::InsufficientSignersWithVotePermission
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let transaction_buffer = &ctx.accounts.transaction_buffer;

        let vault_transaction_message =
            VaultTransactionMessage::deserialize(&mut transaction_buffer.buffer.as_slice())?;
        vault_transaction_message.validate()?;
        let num_lookups = vault_transaction_message.address_table_lookups.len();
        let message_end_index = num_lookups + vault_transaction_message.num_all_account_keys();

        let message_account_infos = ctx
            .remaining_accounts
            .get(num_lookups..message_end_index)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?;

        let address_lookup_table_account_infos = ctx
            .remaining_accounts
            .get(..num_lookups)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?;

        let multi_wallet_key = settings.key();
        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            multi_wallet_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

        let vault_pubkey =
            Pubkey::create_program_address(vault_signer_seed, ctx.program_id).unwrap();

        let executable_message = ExecutableTransactionMessage::new_validated(
            vault_transaction_message,
            message_account_infos,
            address_lookup_table_account_infos,
            &vault_pubkey,
        )?;

        let protected_accounts = &[transaction_buffer.key(), settings.key()];

        executable_message.execute_message(vault_signer_seed, protected_accounts)?;

        Ok(())
    }
}

use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use crate::{state::{DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings, TransactionBufferActionType, SEED_DOMAIN_CONFIG, SEED_MULTISIG}, ExecutableTransactionMessage, MultisigError, Permission, TransactionBuffer, TransactionMessage, VaultTransactionMessage, SEED_TRANSACTION_BUFFER, SEED_VAULT};


#[derive(Accounts)]
pub struct TransactionBufferExecute<'info> {

    #[account(
        seeds = [SEED_DOMAIN_CONFIG, domain_config.load()?.rp_id_hash.as_ref()],
        bump = domain_config.load()?.bump,
    )]
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    
    #[account(
        mut, 
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
        seeds = [
            SEED_MULTISIG,
            transaction_buffer.multi_wallet_settings.as_ref(),
            SEED_TRANSACTION_BUFFER,
            transaction_buffer.creator.get_seed(),
            &transaction_buffer.buffer_index.to_le_bytes(),
        ],
        bump = transaction_buffer.bump,
    )]
    pub transaction_buffer: Box<Account<'info, TransactionBuffer>>,

    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: UncheckedAccount<'info>,
}


impl<'info> TransactionBufferExecute<'info> {
    fn validate(&self, ctx: &Context<'_, '_, '_, 'info, Self>, secp256r1_verify_args:&Option<Secp256r1VerifyArgs>) -> Result<()> {
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

        require!(Clock::get().unwrap().unix_timestamp as u64 <= ctx.accounts.transaction_buffer.expiry, MultisigError::TransactionHasExpired);

        let signer = MemberKey::get_signer(executor, secp256r1_verify_args)?;

        require!(
            settings
            .members
            .iter()
            .any(|x| x.pubkey.eq(&signer) && x.permissions.has(Permission::ExecuteTransaction)),
            MultisigError::InsufficientSignerWithExecutePermission
        );
    
    
        if signer.get_type().eq(&KeyType::Secp256r1) {
            Secp256r1Pubkey::verify_secp256r1(
                secp256r1_verify_args,
                &slot_hash_sysvar.to_account_info(),
                domain_config,
                &transaction_buffer.key(),
                &transaction_buffer.final_buffer_hash,
                TransactionBufferActionType::Execute,
            )?;
        }

        // add executor to signers if executor has vote permission
        require!(
            settings.members
                .iter()
                .filter(|x| x.permissions.has(Permission::VoteTransaction) && (transaction_buffer.voters.contains(&x.pubkey))|| signer.eq(&x.pubkey))
                .count()
                >= settings.threshold as usize,
            MultisigError::NotEnoughSigners
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, secp256r1_verify_args))]
    pub fn process(ctx: Context<'_, '_, '_, 'info, Self>,  secp256r1_verify_args:&Option<Secp256r1VerifyArgs>) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let transaction_buffer = &ctx.accounts.transaction_buffer;
        let transaction_message = TransactionMessage::deserialize(&mut transaction_buffer.buffer.as_slice())?;
        let vault_transaction_message = VaultTransactionMessage::try_from(transaction_message)?;

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

        let protected_accounts = &[transaction_buffer.key()];

        executable_message.execute_message(vault_signer_seed,
            protected_accounts)?;

        settings.reload()?;

        Ok(())
    }
}
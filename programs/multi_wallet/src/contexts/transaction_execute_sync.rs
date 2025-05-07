use crate::{
    id,
    state::{
        DomainConfig, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType, TransactionMessage, SEED_MULTISIG,
    },
    ExecutableTransactionMessage, MultisigError, Permission, SEED_VAULT,
};
use anchor_lang::solana_program::hash::hash;
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionExecuteSync<'info> {
    pub settings: Box<Account<'info, Settings>>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,

    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
}

impl<'info> TransactionExecuteSync<'info> {
    fn validate(
        &self,
        ctx: &Context<'_, '_, '_, 'info, Self>,
        transaction_message: &TransactionMessage,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let Self {
            settings,
            domain_config,
            slot_hash_sysvar,
            ..
        } = self;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;
        let threshold = settings.threshold as usize;

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);
            let is_signer = secp256r1_verify_args.as_ref().map_or(
                ctx.remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .unwrap()
                            .eq(&member.pubkey)
                }),
                |args| {
                    member
                        .pubkey
                        .eq(&MemberKey::convert_secp256r1(&args.pubkey).unwrap())
                },
            );

            if is_signer {
                if has_permission(Permission::InitiateTransaction) {
                    initiate = true;
                }
                if has_permission(Permission::ExecuteTransaction) {
                    execute = true;
                }
                if has_permission(Permission::VoteTransaction) {
                    vote_count += 1;
                }
            }
        }

        require!(
            initiate,
            MultisigError::InsufficientSignerWithInitiatePermission
        );
        require!(
            execute,
            MultisigError::InsufficientSignerWithExecutePermission
        );
        require!(
            vote_count >= threshold,
            MultisigError::InsufficientSignersWithVotePermission
        );

        if secp256r1_verify_args.is_some() {
            let member = settings
                .members
                .iter()
                .find(|x| {
                    x.pubkey.eq(&MemberKey::convert_secp256r1(
                        &secp256r1_verify_args.as_ref().unwrap().pubkey,
                    )
                    .unwrap())
                })
                .ok_or(MultisigError::MissingAccount)?;

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

            let vault_transaction_message =
                transaction_message.convert_to_vault_transaction_message(ctx.remaining_accounts)?;

            let mut writer = Vec::new();
            vault_transaction_message.serialize(&mut writer)?;
            let transaction_message_hash = hash(&writer);

            let secp256r1_verify_data = secp256r1_verify_args
                .as_ref()
                .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            Secp256r1Pubkey::verify_webauthn(
                secp256r1_verify_data,
                slot_hash_sysvar,
                domain_config,
                &settings.key(),
                &transaction_message_hash.to_bytes(),
                TransactionActionType::Sync,
            )?;
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &transaction_message, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let settings = &ctx.accounts.settings;
        let vault_transaction_message =
            transaction_message.convert_to_vault_transaction_message(ctx.remaining_accounts)?;
        vault_transaction_message.validate()?;
        let num_lookups = vault_transaction_message.address_table_lookups.len();
        let message_end_index = num_lookups + vault_transaction_message.num_all_account_keys();

        let address_lookup_table_account_infos = ctx
            .remaining_accounts
            .get(..num_lookups)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?;

        let message_account_infos = ctx
            .remaining_accounts
            .get(num_lookups..message_end_index)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?;

        let multi_wallet_key = settings.key();
        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            multi_wallet_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

        let vault_pubkey = Pubkey::create_program_address(vault_signer_seed, &id()).unwrap();

        let executable_message = ExecutableTransactionMessage::new_validated(
            vault_transaction_message,
            message_account_infos,
            address_lookup_table_account_infos,
            &vault_pubkey,
        )?;

        let protected_accounts = &[settings.key()];

        executable_message.execute_message(vault_signer_seed, protected_accounts)?;

        Ok(())
    }
}

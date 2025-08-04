use crate::{
    id,
    state::{
        ChallengeArgs, DomainConfig, MemberKey, Secp256r1VerifyArgs, Settings,
        TransactionActionType, TransactionMessage, SEED_MULTISIG,
    },
    utils::durable_nonce_check,
    ExecutableTransactionMessage, MultisigError, Permission, SEED_VAULT,
};
use anchor_lang::solana_program::hash::hash;
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionExecuteSync<'info> {
    #[account(mut)]
    pub settings: AccountLoader<'info, Settings>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
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
            instructions_sysvar,
            ..
        } = self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let settings = settings.load()?;
        let threshold = settings.threshold as usize;
        let secp256r1_member_key =
            MemberKey::get_signer(&None, secp256r1_verify_args, Some(instructions_sysvar))
                .map_or(None, |f| Some(f));

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);

            let is_secp256r1_signer =
                secp256r1_member_key.is_some() && member.pubkey.eq(&secp256r1_member_key.unwrap());
            let is_signer = is_secp256r1_signer
                || ctx.remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .unwrap()
                            .eq(&member.pubkey)
                });

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

            if is_secp256r1_signer {
                require!(
                    member.domain_config.ne(&Pubkey::default()),
                    MultisigError::DomainConfigIsMissing
                );

                require!(
                    domain_config.is_some()
                        && domain_config
                            .as_ref()
                            .unwrap()
                            .key()
                            .eq(&member.domain_config),
                    MultisigError::MemberDoesNotBelongToDomainConfig
                );

                let vault_transaction_message = transaction_message
                    .convert_to_vault_transaction_message(ctx.remaining_accounts)?;

                let mut writer = Vec::new();
                vault_transaction_message.serialize(&mut writer)?;
                let transaction_message_hash = hash(&writer);

                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                secp256r1_verify_data.verify_webauthn(
                    slot_hash_sysvar,
                    domain_config,
                    instructions_sysvar,
                    ChallengeArgs {
                        account: ctx.accounts.settings.key(),
                        message_hash: transaction_message_hash.to_bytes(),
                        action_type: TransactionActionType::Sync,
                    },
                )?;
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

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &transaction_message, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let settings = ctx.accounts.settings.load()?;
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

        let settings_key = ctx.accounts.settings.key();
        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

        drop(settings);

        let vault_pubkey = Pubkey::create_program_address(vault_signer_seed, &id()).unwrap();

        let executable_message = ExecutableTransactionMessage::new_validated(
            vault_transaction_message,
            message_account_infos,
            address_lookup_table_account_infos,
            &vault_pubkey,
        )?;

        let protected_accounts = &[];

        executable_message.execute_message(vault_signer_seed, protected_accounts, None)?;

        Ok(())
    }
}

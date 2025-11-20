use crate::{
    durable_nonce_check, id, ChallengeArgs, DomainConfig, ExecutableTransactionMessage, MemberKey,
    MultisigError, Permission, Secp256r1VerifyArgsWithDomainAddress, Settings,
    TransactionActionType, TransactionMessage, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::light_hasher::{Hasher, Sha256};

#[derive(Accounts)]
pub struct TransactionExecuteSync<'info> {
    #[account(mut)]
    pub settings: AccountLoader<'info, Settings>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> TransactionExecuteSync<'info> {
    fn validate(
        &self,
        ctx: &Context<'_, '_, 'info, 'info, Self>,
        transaction_message: &TransactionMessage,
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        let Self {
            settings,
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
        let secp256r1_member_keys: Vec<(MemberKey, &Secp256r1VerifyArgsWithDomainAddress)> =
            secp256r1_verify_args
                .iter()
                .filter_map(|arg| {
                    let pubkey = arg
                        .verify_args
                        .extract_public_key_from_instruction(Some(&self.instructions_sysvar))
                        .ok()?;

                    let member_key = MemberKey::convert_secp256r1(&pubkey).ok()?;

                    Some((member_key, arg))
                })
                .collect();

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);

            let secp256r1_signer = secp256r1_member_keys
                .iter()
                .find(|f| f.0.eq(&member.pubkey));
            let is_signer = secp256r1_signer.is_some()
                || ctx.remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .map_or(false, |key| key.eq(&member.pubkey))
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

            if let Some((_, secp256r1_verify_data)) = secp256r1_signer {
                let vault_transaction_message = transaction_message
                    .convert_to_vault_transaction_message(ctx.remaining_accounts)?;

                let mut writer = Vec::new();
                vault_transaction_message.serialize(&mut writer)?;
                let transaction_message_hash = Sha256::hash(&writer).unwrap();

                let account_loader = DomainConfig::extract_domain_config_account(
                    ctx.remaining_accounts,
                    secp256r1_verify_data.domain_config_key,
                )?;

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: ctx.accounts.settings.key(),
                        message_hash: transaction_message_hash,
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
        ctx: Context<'_, '_, 'info, 'info, Self>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
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

        let vault_pubkey =
            Pubkey::create_program_address(vault_signer_seed, &id()).map_err(ProgramError::from)?;

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

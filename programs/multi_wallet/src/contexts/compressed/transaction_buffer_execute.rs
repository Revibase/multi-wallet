use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        SettingsArgs, TransactionActionType,
    },
    MultisigError, Permission, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::account::LightAccount;

#[derive(Accounts)]
pub struct TransactionBufferExecuteCompressed<'info> {
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    pub executor: Option<Signer<'info>>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl<'info> TransactionBufferExecuteCompressed<'info> {
    fn validate(
        &self,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings_args: &SettingsArgs,
    ) -> Result<()> {
        let Self {
            transaction_buffer,
            executor,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        transaction_buffer.validate_hash()?;
        transaction_buffer.validate_size()?;

        let settings = LightAccount::<'_, Settings>::new_mut(
            &crate::ID,
            &settings_args.account_meta,
            settings_args.settings.clone(),
        )
        .map_err(ProgramError::from)?;
        let settings_key = Pubkey::new_from_array(settings.address().unwrap());
        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::InvalidAccount
        );
        if transaction_buffer.permissionless_execution {
            let vote_count = settings
                .members
                .iter()
                .filter(|x| {
                    x.permissions.has(Permission::VoteTransaction)
                        && (transaction_buffer.voters.contains(&x.pubkey))
                })
                .count();

            require!(
                vote_count >= settings.threshold as usize,
                MultisigError::InsufficientSignersWithVotePermission
            );
            return Ok(());
        }

        let signer = MemberKey::get_signer(executor, secp256r1_verify_args)?;

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        require!(
            member.permissions.has(Permission::ExecuteTransaction),
            MultisigError::InsufficientSignerWithExecutePermission
        );

        let vote_count = settings
            .members
            .iter()
            .filter(|x| {
                x.permissions.has(Permission::VoteTransaction)
                    && (transaction_buffer.voters.contains(&x.pubkey) || signer.eq(&x.pubkey))
            })
            .count();

        require!(
            vote_count >= settings.threshold as usize,
            MultisigError::InsufficientSignersWithVotePermission
        );

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
                &transaction_buffer.final_buffer_hash,
                TransactionActionType::Execute,
                instructions_sysvar,
            )?;
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&secp256r1_verify_args, &settings_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsArgs,
    ) -> Result<()> {
        ctx.accounts.transaction_buffer.can_execute = true;
        Ok(())
    }
}

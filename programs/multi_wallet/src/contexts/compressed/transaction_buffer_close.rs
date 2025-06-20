use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        SettingsArgs, TransactionActionType,
    },
    MultisigError, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::account::LightAccount;

#[derive(Accounts)]
pub struct TransactionBufferCloseCompressed<'info> {
    /// CHECK:
    #[account(
            mut,
            constraint = payer.key() == transaction_buffer.payer @MultisigError::InvalidAccount
        )]
    pub payer: UncheckedAccount<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        mut,
        close = payer,
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
    pub closer: Option<Signer<'info>>,
    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl TransactionBufferCloseCompressed<'_> {
    fn validate(
        &self,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings_args: &SettingsArgs,
    ) -> Result<()> {
        let Self {
            closer,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;
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
        let signer = MemberKey::get_signer(closer, secp256r1_verify_args)?;

        // allow rent payer to become the closer after transaction has expired
        if Clock::get().unwrap().unix_timestamp as u64 > transaction_buffer.valid_till
            && signer.get_type().eq(&KeyType::Ed25519)
            && MemberKey::convert_ed25519(&transaction_buffer.payer)?.eq(&signer)
        {
            Ok(())
        } else {
            require!(
                transaction_buffer.creator.eq(&signer),
                MultisigError::UnauthorisedToCloseTransactionBuffer
            );
            if signer.get_type().eq(&KeyType::Secp256r1) {
                let member = settings
                    .members
                    .iter()
                    .find(|x| x.pubkey.eq(&signer))
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

                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                Secp256r1Pubkey::verify_webauthn(
                    secp256r1_verify_data,
                    slot_hash_sysvar,
                    domain_config,
                    &transaction_buffer.key(),
                    &transaction_buffer.final_buffer_hash,
                    TransactionActionType::Close,
                    instructions_sysvar,
                )?;
            }

            Ok(())
        }
    }

    #[access_control(ctx.accounts.validate(&secp256r1_verify_args, &settings_args))]
    pub fn process(
        ctx: Context<Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsArgs,
    ) -> Result<()> {
        Ok(())
    }
}

use crate::{
    error::MultisigError,
    state::{
        CompressedSettings, DomainConfig, ProofArgs, Settings, SettingsIndexWithAddress,
        SettingsMutArgs, User, UserMutArgs,
    },
    utils::{
        ChallengeArgs, Member, MemberKey, Secp256r1VerifyArgs, TransactionActionType, UserRole,
    },
    LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
    LightAccount,
};

#[derive(Accounts)]
pub struct EditUserDelegate<'info> {
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    pub signer: Option<Signer<'info>>,
    #[account(mut)]
    pub old_settings: Option<AccountLoader<'info, Settings>>,
    #[account(mut)]
    pub new_settings: Option<AccountLoader<'info, Settings>>,
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
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
}

impl<'info> EditUserDelegate<'info> {
    fn update_delegate_flag(
        members: &mut [Member],
        user_key: MemberKey,
        user_address_tree_index: u8,
        flag: bool,
    ) -> Result<()> {
        for m in members.iter_mut() {
            if m.pubkey.eq(&user_key) && m.user_address_tree_index.eq(&user_address_tree_index) {
                m.is_delegate = flag.into();
                return Ok(());
            }
        }
        return err!(MultisigError::InvalidAccount);
    }

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        user_mut_args: UserMutArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        delegate_to: Option<SettingsIndexWithAddress>,
        old_settings_mut_args: Option<SettingsMutArgs>,
        new_settings_mut_args: Option<SettingsMutArgs>,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let signer: MemberKey = MemberKey::get_signer(
            &ctx.accounts.signer,
            &secp256r1_verify_args,
            ctx.accounts.instructions_sysvar.as_ref(),
        )?;

        let mut user_account = LightAccount::<User>::new_mut(
            &crate::ID,
            &user_mut_args.account_meta,
            user_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        require!(
            user_account.role.eq(&UserRole::Member),
            MultisigError::InvalidUserRole
        );

        require!(
            user_account.member.eq(&signer),
            MultisigError::UnexpectedSigner
        );

        if signer.get_type().eq(&crate::utils::KeyType::Secp256r1) {
            let secp256r1_verify_data = secp256r1_verify_args
                .as_ref()
                .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            let instructions_sysvar = ctx
                .accounts
                .instructions_sysvar
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;

            let domain_config = ctx
                .accounts
                .domain_config
                .as_ref()
                .ok_or(MultisigError::DomainConfigIsMissing)?;

            let expected_domain_config = user_account
                .domain_config
                .as_ref()
                .ok_or(MultisigError::DomainConfigIsMissing)?;

            require!(
                expected_domain_config.eq(&domain_config.key()),
                MultisigError::DomainConfigIsMissing
            );

            let mut buffer = vec![];
            if let Some(delegated_to) = &user_account.delegated_to {
                buffer.extend_from_slice(delegated_to.index.to_le_bytes().as_ref());
            } else {
                buffer.extend_from_slice(crate::ID.as_ref());
            }
            if let Some(delegated_to) = &delegate_to {
                buffer.extend_from_slice(delegated_to.index.to_le_bytes().as_ref());
            } else {
                buffer.extend_from_slice(crate::ID.as_ref());
            }

            let message_hash = Sha256::hash(&buffer).unwrap();

            secp256r1_verify_data.verify_webauthn(
                &ctx.accounts.slot_hash_sysvar,
                &ctx.accounts.domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: Pubkey::from(
                        user_account
                            .address()
                            .ok_or(MultisigError::InvalidAccount)?,
                    ),
                    message_hash,
                    action_type: TransactionActionType::ChangeDelegate,
                },
                None,
            )?;
        }

        let mut cpi_accounts = LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        );
        if let Some(old_delegate) = &user_account.delegated_to {
            if let Some(old_settings) = &ctx.accounts.old_settings {
                let settings_data = &mut old_settings.load_mut()?;
                require!(
                    settings_data.index.eq(&old_delegate.index)
                        && settings_data
                            .settings_address_tree_index
                            .eq(&old_delegate.settings_address_tree_index),
                    MultisigError::InvalidAccount
                );
                Self::update_delegate_flag(
                    &mut settings_data.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    false,
                )?;
                settings_data.invariant()?;
            } else if let Some(old_settings_mut_args) = old_settings_mut_args {
                let mut settings_account = LightAccount::<CompressedSettings>::new_mut(
                    &crate::ID,
                    &old_settings_mut_args.account_meta,
                    old_settings_mut_args.data,
                )
                .map_err(ProgramError::from)?;
                let settings_data = settings_account
                    .data
                    .as_mut()
                    .ok_or(MultisigError::InvalidArguments)?;
                require!(
                    settings_data.index.eq(&old_delegate.index)
                        && settings_data
                            .settings_address_tree_index
                            .eq(&old_delegate.settings_address_tree_index),
                    MultisigError::InvalidArguments
                );
                Self::update_delegate_flag(
                    &mut settings_data.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    false,
                )?;
                settings_account.invariant()?;
                cpi_accounts = cpi_accounts.with_light_account(settings_account)?;
            } else {
                return err!(MultisigError::MissingAccount);
            }
        }

        if let Some(new_delegate) = &delegate_to {
            if let Some(new_settings) = &ctx.accounts.new_settings {
                let settings_data = &mut new_settings.load_mut()?;
                require!(
                    settings_data.index.eq(&new_delegate.index)
                        && settings_data
                            .settings_address_tree_index
                            .eq(&new_delegate.settings_address_tree_index),
                    MultisigError::InvalidAccount
                );
                Self::update_delegate_flag(
                    &mut settings_data.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    true,
                )?;
                settings_data.invariant()?;
            } else if let Some(new_settings_mut_args) = new_settings_mut_args {
                let mut settings_account = LightAccount::<CompressedSettings>::new_mut(
                    &crate::ID,
                    &new_settings_mut_args.account_meta,
                    new_settings_mut_args.data,
                )
                .map_err(ProgramError::from)?;
                let settings_data = settings_account
                    .data
                    .as_mut()
                    .ok_or(MultisigError::InvalidArguments)?;
                require!(
                    settings_data.index.eq(&new_delegate.index)
                        && settings_data
                            .settings_address_tree_index
                            .eq(&new_delegate.settings_address_tree_index),
                    MultisigError::InvalidArguments
                );
                Self::update_delegate_flag(
                    &mut settings_data.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    true,
                )?;
                settings_account.invariant()?;
                cpi_accounts = cpi_accounts.with_light_account(settings_account)?;
            } else {
                return err!(MultisigError::MissingAccount);
            }
        }

        user_account.delegated_to = delegate_to;

        user_account.invariant()?;

        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.fee_payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        cpi_accounts
            .with_light_account(user_account)?
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

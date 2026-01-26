use crate::{
    error::MultisigError,
    state::{
        CompressedSettings, DomainConfig, ProofArgs, Settings, SettingsIndexWithAddress,
        SettingsMutArgs, User, UserMutArgs,
    },
    utils::{
        bool_to_u8_delegate, ChallengeArgs, Member, MemberKey, Secp256r1VerifyArgs,
        TransactionActionType, UserRole,
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
    pub old_settings: Option<Account<'info, Settings>>,
    #[account(mut)]
    pub new_settings: Option<Account<'info, Settings>>,
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
                m.is_delegate = bool_to_u8_delegate(flag);
                return Ok(());
            }
        }
        return err!(MultisigError::MemberNotFound);
    }

    fn validate(
        &self,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        user_account: &LightAccount<User>,
        account: Pubkey,
        old_settings_delegate: &Option<SettingsIndexWithAddress>,
        new_settings_delegate: &Option<SettingsIndexWithAddress>,
    ) -> Result<()> {
        let Self {
            signer,
            instructions_sysvar,
            domain_config,
            slot_hash_sysvar,
            ..
        } = self;
        let signer: MemberKey = MemberKey::get_signer(
            &signer,
            &secp256r1_verify_args,
            instructions_sysvar.as_ref(),
        )?;

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

            let instructions_sysvar = instructions_sysvar
                .as_ref()
                .ok_or(MultisigError::MissingInstructionsSysvar)?;

            let given_domain_config = domain_config
                .as_ref()
                .ok_or(MultisigError::DomainConfigIsMissing)?;

            let expected_domain_config = user_account
                .domain_config
                .as_ref()
                .ok_or(MultisigError::DomainConfigIsMissing)?;

            require!(
                expected_domain_config.eq(&given_domain_config.key()),
                MultisigError::DomainConfigKeyMismatch
            );

            // Pre-allocate buffer: 2 u128 values = 32 bytes
            let mut buffer = Vec::with_capacity(32);
            buffer.extend_from_slice(
                old_settings_delegate
                    .as_ref()
                    .map_or(0u128, |f| f.index)
                    .to_le_bytes()
                    .as_ref(),
            );
            buffer.extend_from_slice(
                new_settings_delegate
                    .as_ref()
                    .map_or(0u128, |f| f.index)
                    .to_le_bytes()
                    .as_ref(),
            );
            buffer.extend_from_slice(
                user_account
                    .address()
                    .ok_or(MultisigError::MissingUserAccountAddress)?
                    .as_ref(),
            );
            let message_hash =
                Sha256::hash(&buffer).map_err(|_| MultisigError::HashComputationFailed)?;

            secp256r1_verify_data.verify_webauthn(
                slot_hash_sysvar,
                domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account,
                    message_hash,
                    action_type: TransactionActionType::ChangeDelegate,
                },
                &[],
            )?;
        }

        Ok(())
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
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.fee_payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let mut user_account = LightAccount::<User>::new_mut(
            &crate::ID,
            &user_mut_args.account_meta,
            user_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        let mut cpi_accounts = LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        );

        let mut account: Option<Pubkey> = None;
        let mut old_delegate_index: Option<SettingsIndexWithAddress> = None;
        if let Some(old_delegate) = &user_account.wallets.iter().find(|f| f.is_delegate) {
            if let Some(old_settings) = &mut ctx.accounts.old_settings {
                require!(
                    old_settings.index.eq(&old_delegate.index)
                        && old_settings
                            .settings_address_tree_index
                            .eq(&old_delegate.settings_address_tree_index),
                    MultisigError::SettingsKeyMismatch
                );
                Self::update_delegate_flag(
                    &mut old_settings.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    false,
                )?;
                if let Some(secp256r1_verify_args) = &secp256r1_verify_args {
                    old_settings.latest_slot_number_check(
                        &[secp256r1_verify_args.slot_number],
                        &ctx.accounts.slot_hash_sysvar,
                    )?;
                }
                account = Some(old_settings.key());
                old_delegate_index = Some(SettingsIndexWithAddress {
                    index: old_settings.index,
                    settings_address_tree_index: old_settings.settings_address_tree_index,
                });
                old_settings.invariant()?;
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
                    .ok_or(MultisigError::MissingSettingsData)?;
                require!(
                    settings_data.index.eq(&old_delegate.index)
                        && settings_data
                            .settings_address_tree_index
                            .eq(&old_delegate.settings_address_tree_index),
                    MultisigError::SettingsKeyMismatch
                );
                Self::update_delegate_flag(
                    &mut settings_data.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    false,
                )?;
                old_delegate_index = Some(SettingsIndexWithAddress {
                    index: settings_data.index,
                    settings_address_tree_index: settings_data.settings_address_tree_index,
                });
                account = Some(Settings::get_settings_key_from_index(
                    settings_data.index,
                    settings_data.bump,
                )?);
                if let Some(secp256r1_verify_args) = &secp256r1_verify_args {
                    settings_account.latest_slot_number_check(
                        &[secp256r1_verify_args.slot_number],
                        &ctx.accounts.slot_hash_sysvar,
                    )?;
                }

                settings_account.invariant()?;
                cpi_accounts = cpi_accounts.with_light_account(settings_account)?;
            } else {
                return err!(MultisigError::MissingSettingsAccountForDelegate);
            }
        }

        if let Some(new_delegate) = &delegate_to {
            if let Some(new_settings) = &mut ctx.accounts.new_settings {
                require!(
                    new_settings.index.eq(&new_delegate.index)
                        && new_settings
                            .settings_address_tree_index
                            .eq(&new_delegate.settings_address_tree_index),
                    MultisigError::SettingsKeyMismatch
                );
                Self::update_delegate_flag(
                    &mut new_settings.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    true,
                )?;
                if let Some(secp256r1_verify_args) = &secp256r1_verify_args {
                    new_settings.latest_slot_number_check(
                        &[secp256r1_verify_args.slot_number],
                        &ctx.accounts.slot_hash_sysvar,
                    )?;
                }
                if account.is_none() {
                    account = Some(new_settings.key());
                }
                new_settings.invariant()?;
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
                    .ok_or(MultisigError::MissingSettingsData)?;

                require!(
                    settings_data.index.eq(&new_delegate.index)
                        && settings_data
                            .settings_address_tree_index
                            .eq(&new_delegate.settings_address_tree_index),
                    MultisigError::SettingsKeyMismatch
                );
                Self::update_delegate_flag(
                    &mut settings_data.members,
                    user_account.member,
                    user_account.user_address_tree_index,
                    true,
                )?;
                if account.is_none() {
                    account = Some(Settings::get_settings_key_from_index(
                        settings_data.index,
                        settings_data.bump,
                    )?);
                }
                if let Some(secp256r1_verify_args) = &secp256r1_verify_args {
                    settings_account.latest_slot_number_check(
                        &[secp256r1_verify_args.slot_number],
                        &ctx.accounts.slot_hash_sysvar,
                    )?;
                }

                settings_account.invariant()?;
                cpi_accounts = cpi_accounts.with_light_account(settings_account)?;
            } else {
                return err!(MultisigError::MissingSettingsAccountForDelegate);
            }
        }

        ctx.accounts.validate(
            &secp256r1_verify_args,
            &user_account,
            account.ok_or(MultisigError::InvalidArguments)?,
            &old_delegate_index,
            &delegate_to,
        )?;

        user_account.wallets.iter_mut().for_each(|f| {
            f.is_delegate = delegate_to.as_ref().map_or(false, |x| {
                x.index == f.index && x.settings_address_tree_index == f.settings_address_tree_index
            });
        });

        user_account.invariant()?;

        cpi_accounts
            .with_light_account(user_account)?
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

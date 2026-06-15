use crate::{
    error::MultisigError,
    state::{DomainConfig, Settings, User},
    utils::{
        bool_to_u8_delegate, ChallengeArgs, Member, MemberKey, Secp256r1VerifyArgs,
        TransactionActionType, UserRole, SEED_USER,
    },
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use sha2::{Digest, Sha256};

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Option<Secp256r1VerifyArgs>)]
pub struct EditUserDelegate<'info> {
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    pub signer: Option<Signer<'info>>,
    #[account(
        mut,
        seeds = [SEED_USER, {
            let signer: MemberKey = MemberKey::get_signer(
                &signer,
                &secp256r1_verify_args,
                instructions_sysvar.as_ref(),
            )?;
            &signer.get_seed()?
        }],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, User>,
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
    fn update_delegate_flag(members: &mut [Member], user_key: MemberKey, flag: bool) -> Result<()> {
        for m in members.iter_mut() {
            if m.pubkey.eq(&user_key) {
                m.is_delegate = bool_to_u8_delegate(flag);
                return Ok(());
            }
        }
        return err!(MultisigError::MemberNotFound);
    }

    pub fn process(
        ctx: Context<'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        delegate_to: Option<u128>,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;

        let mut account: Option<Pubkey> = None;
        let mut old_delegate_index: Option<u128> = None;
        if let Some(old_delegate) = &user_account.wallets.iter().find(|f| f.is_delegate) {
            if let Some(old_settings) = &mut ctx.accounts.old_settings {
                require!(
                    old_settings.index.eq(&old_delegate.index),
                    MultisigError::SettingsKeyMismatch
                );
                Self::update_delegate_flag(&mut old_settings.members, user_account.member, false)?;
                if let Some(secp256r1_verify_args) = &secp256r1_verify_args {
                    old_settings.latest_slot_number_check(
                        &[secp256r1_verify_args.slot_number],
                        &ctx.accounts.slot_hash_sysvar,
                    )?;
                }
                account = Some(old_settings.key());
                old_delegate_index = Some(old_settings.index);
                old_settings.invariant()?;
            } else {
                return err!(MultisigError::MissingSettingsAccountForDelegate);
            }
        }

        if let Some(new_delegate_index) = &delegate_to {
            if let Some(new_settings) = &mut ctx.accounts.new_settings {
                require!(
                    new_settings.index.eq(&new_delegate_index),
                    MultisigError::SettingsKeyMismatch
                );
                Self::update_delegate_flag(&mut new_settings.members, user_account.member, true)?;
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
            } else {
                return err!(MultisigError::MissingSettingsAccountForDelegate);
            }
        }

        let signer: MemberKey = MemberKey::get_signer(
            &ctx.accounts.signer,
            &secp256r1_verify_args,
            ctx.accounts.instructions_sysvar.as_ref(),
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

            let instructions_sysvar = ctx
                .accounts
                .instructions_sysvar
                .as_ref()
                .ok_or(MultisigError::MissingInstructionsSysvar)?;

            let given_domain_config = ctx
                .accounts
                .domain_config
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
                old_delegate_index
                    .as_ref()
                    .map_or(0u128, |f| *f)
                    .to_le_bytes()
                    .as_ref(),
            );
            buffer.extend_from_slice(
                delegate_to
                    .as_ref()
                    .map_or(0u128, |f| *f)
                    .to_le_bytes()
                    .as_ref(),
            );
            buffer.extend_from_slice(user_account.key().as_ref());
            let message_hash =
                Sha256::digest(&buffer).into();

            secp256r1_verify_data.verify_webauthn(
                &ctx.accounts.slot_hash_sysvar,
                &ctx.accounts.domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: account.ok_or(MultisigError::InvalidArguments)?,
                    message_hash,
                    action_type: TransactionActionType::ChangeDelegate,
                },
                &[],
            )?;
        }

        user_account.wallets.iter_mut().for_each(|f| {
            f.is_delegate = delegate_to.as_ref().map_or(false, |x| x.eq(&f.index));
        });

        user_account.invariant()?;

        Ok(())
    }
}

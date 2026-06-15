use crate::{
    state::{Settings, User, UserWalletOperation},
    utils::{
        resize_account_if_necessary, MultisigSettings, TransactionActionType,
        TransactionSyncSigners,
    },
    ConfigAction,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use sha2::{Digest, Sha256};

#[derive(Accounts)]
pub struct ChangeConfig<'info> {
    #[account(mut)]
    pub settings: Account<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
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

impl<'info> ChangeConfig<'info> {
    fn validate(
        &self,
        ctx: &Context<'info, Self>,
        config_actions: &[ConfigAction],
        signers: &[TransactionSyncSigners],
    ) -> Result<()> {
        let Self {
            settings,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        let mut writer = Vec::new();
        config_actions.serialize(&mut writer)?;
        let message_hash =
            Sha256::digest(&writer).into();

        TransactionSyncSigners::verify(
            signers,
            ctx.remaining_accounts,
            instructions_sysvar,
            slot_hash_sysvar,
            settings.get_members()?,
            settings.get_threshold()?,
            ctx.accounts.settings.key(),
            message_hash,
            TransactionActionType::ChangeConfig,
        )?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &config_actions, &signers))]
    pub fn process(
        ctx: Context<'info, Self>,
        config_actions: Vec<ConfigAction>,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;

        let mut wallet_operations: Vec<UserWalletOperation> = Vec::new();
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    settings.edit_permissions(members)?;
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(members, ctx.remaining_accounts)?;
                    wallet_operations.extend(ops.into_iter().map(UserWalletOperation::Add));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    wallet_operations.extend(ops.into_iter().map(UserWalletOperation::Remove));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold)?;
                }
            }
        }

        resize_account_if_necessary(
            settings.as_ref(),
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            Settings::size(settings.get_members()?.len()),
        )?;

        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        User::process_user_wallet_operations(
            wallet_operations,
            settings.index,
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            ctx.remaining_accounts,
        )?;

        Ok(())
    }
}

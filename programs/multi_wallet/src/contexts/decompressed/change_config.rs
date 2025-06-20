use crate::{
    state::{Delegate, DelegateOp, Settings, SEED_MULTISIG, SEED_VAULT},
    utils::realloc_if_needed,
    ConfigAction,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use std::vec;

#[derive(Accounts)]
pub struct ChangeConfig<'info> {
    #[account(mut)]
    pub settings: Account<'info, Settings>,
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_VAULT,
        ],
        bump = settings.multi_wallet_bump
    )]
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
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl<'info> ChangeConfig<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        config_actions: Vec<ConfigAction>,
    ) -> Result<()> {
        let slot_hash_sysvar = &ctx.accounts.slot_hash_sysvar;
        let instructions_sysvar = &ctx.accounts.instructions_sysvar;
        let settings = &mut ctx.accounts.settings;
        let payer = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let settings_account_info = settings.to_account_info();
        let current_size = settings_account_info.data_len();
        let settings_key = settings_account_info.key();

        let mut delegate_ops: Vec<DelegateOp> = vec![];
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    settings.edit_permissions(members);
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(
                        &settings_key,
                        members,
                        remaining_accounts,
                        slot_hash_sysvar,
                        instructions_sysvar,
                    )?;
                    delegate_ops.extend(ops.into_iter().map(DelegateOp::Create));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    delegate_ops.extend(ops.into_iter().map(DelegateOp::Close));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold);
                }
            }
        }

        Delegate::handle_delegate_accounts(delegate_ops, settings_key, payer, remaining_accounts)?;

        realloc_if_needed(
            &settings.to_account_info(),
            current_size,
            Settings::size(settings.members.len()),
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;

        settings.invariant()?;

        Ok(())
    }
}

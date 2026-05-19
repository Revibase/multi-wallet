use crate::{
    id,
    utils::UserRole,
    utils::{MultisigSettings, SEED_GLOBAL_COUNTER},
    AddMemberArgs, GlobalCounter, MultisigError, Permission, Permissions, Settings,
    SettingsIndexWithDelegateInfo, User, SEED_MULTISIG, SEED_USER, SEED_VAULT,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(settings_index: u128 )]
pub struct CreateWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub initial_member: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        mut,
        seeds = [SEED_GLOBAL_COUNTER],
        bump
    )]
    pub global_counter: AccountLoader<'info, GlobalCounter>,
    #[account(
        mut,
        seeds = [SEED_USER, initial_member.key.as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, User>,
    #[account(
        init,
        payer = payer,
        space = Settings::size(1),
        seeds = [
            SEED_MULTISIG,
            settings_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub settings: Account<'info, Settings>,
}

impl<'info> CreateWallet<'info> {
    pub fn process(ctx: Context<'_, '_, 'info, 'info, Self>, settings_index: u128) -> Result<()> {
        let global_counter = &mut ctx.accounts.global_counter.load_mut()?;
        require!(
            settings_index.eq(&global_counter.index),
            MultisigError::InvalidArguments
        );
        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[
                SEED_MULTISIG,
                ctx.accounts.settings.key().as_ref(),
                SEED_VAULT,
            ],
            &id(),
        );
        let settings = &mut ctx.accounts.settings;
        settings.set_threshold(1)?;
        settings.set_members(Vec::new())?;
        settings.set_latest_slot_number(0u64)?;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.bump = ctx.bumps.settings;
        settings.index = settings_index;

        settings.add_members(
            vec![AddMemberArgs {
                member_key: ctx.accounts.user_account.member,
                permissions: Permissions::from_permissions(vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ]),
            }],
            &[ctx.accounts.user_account.to_account_info()],
        )?;

        settings.invariant()?;

        if ctx.accounts.user_account.role.eq(&UserRole::Member) {
            ctx.accounts
                .user_account
                .wallets
                .push(SettingsIndexWithDelegateInfo {
                    index: settings_index,
                    is_delegate: false,
                });
        }
        ctx.accounts.user_account.invariant()?;

        global_counter.index += 1;
        Ok(())
    }
}

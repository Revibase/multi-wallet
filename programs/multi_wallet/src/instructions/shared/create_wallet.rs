use crate::{
    id,
    utils::{resize_account_if_necessary, MultisigSettings, UserRole, SEED_GLOBAL_COUNTER},
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
    pub fn process(ctx: Context<'info, Self>, settings_index: u128) -> Result<()> {
        let global_counter = &mut ctx.accounts.global_counter.load_mut()?;

        require!(
            settings_index == global_counter.index,
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
        settings.set_latest_slot_number(0)?;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.bump = ctx.bumps.settings;
        settings.index = settings_index;

        let user_member = ctx.accounts.user_account.member;

        settings.add_members(
            vec![AddMemberArgs {
                member_key: user_member,
                permissions: Permissions::from_permissions(vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ]),
            }],
            &[ctx.accounts.user_account.to_account_info()],
        )?;

        settings.invariant()?;

        {
            let user_account = &ctx.accounts.user_account;

            if user_account.role == UserRole::Member {
                let new_wallet_len = user_account.wallets.len() + 1;

                let new_size = User::size(
                    user_account.credential_id.as_ref().map_or(0, |f| f.len()),
                    user_account.transports.as_ref().map_or(0, |f| f.len()),
                    user_account
                        .transaction_manager_url
                        .as_ref()
                        .map_or(0, |f| f.len()),
                    new_wallet_len,
                );

                resize_account_if_necessary(
                    &user_account.to_account_info(),
                    &ctx.accounts.payer.to_account_info(),
                    &ctx.accounts.system_program.to_account_info(),
                    new_size,
                )?;
            }
        }

        {
            let user_account = &mut ctx.accounts.user_account;

            if user_account.role == UserRole::Member {
                user_account.wallets.push(SettingsIndexWithDelegateInfo {
                    index: settings_index,
                    is_delegate: false,
                });
            }

            user_account.invariant()?;
        }

        global_counter.index += 1;

        Ok(())
    }
}

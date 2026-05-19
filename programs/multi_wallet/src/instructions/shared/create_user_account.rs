use crate::{utils::UserRole, MemberKey, User, SEED_USER};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateUserAccountArgs {
    pub role: UserRole,
    pub transaction_manager_url: Option<String>,
}

#[derive(Accounts)]
#[instruction(args: CreateUserAccountArgs)]
pub struct CreateUserAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub member: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        init,
        payer = payer,
        space = User::size(0 ,0, args.transaction_manager_url.map_or(0, |f| f.len())),
        seeds = [SEED_USER, member.key.as_ref()],
        bump
    )]
    pub user_account: Account<'info, User>,
}

impl<'info> CreateUserAccount<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        args: CreateUserAccountArgs,
    ) -> Result<()> {
        let user = &mut ctx.accounts.user_account;
        user.member = MemberKey::convert_ed25519(&ctx.accounts.member.key())?;
        user.role = args.role;
        user.wallets = Vec::new();
        user.transports = None;
        user.credential_id = None;
        user.domain_config = None;
        user.transaction_manager_url = args.transaction_manager_url;
        user.bump = ctx.bumps.user_account;

        user.invariant()?;

        Ok(())
    }
}

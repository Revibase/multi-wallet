use crate::state::DelegateExtensions;
use crate::ADMIN;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct MigrateDelegateExtension<'info> {
    #[account(
        mut,
        address = ADMIN,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> MigrateDelegateExtension<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        api_url: String,
        member: Pubkey,
    ) -> Result<()> {
        DelegateExtensions::initialize(
            api_url,
            &member,
            ctx.remaining_accounts,
            &ctx.accounts.authority,
            &ctx.accounts.system_program,
        )?;
        Ok(())
    }
}

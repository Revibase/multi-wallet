use crate::{
    state::{DelegateExtensions, DomainConfig},
    ADMIN_DOMAIN_CONFIG,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct MigrateDelegateExtension<'info> {
    #[account(
        mut,
        address = admin_domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    #[account(
        address = ADMIN_DOMAIN_CONFIG
    )]
    pub admin_domain_config: AccountLoader<'info, DomainConfig>,
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

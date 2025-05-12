use crate::{state::DomainConfig, ADMIN};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DeleteDomainConfig<'info> {
    #[account(
        mut,
        close = admin,
    )]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    /// CHECK:
    #[account(
        mut,
        address = ADMIN
    )]
    pub admin: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = authority.key() == domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> DeleteDomainConfig<'info> {
    pub fn process(_ctx: Context<Self>) -> Result<()> {
        Ok(())
    }
}

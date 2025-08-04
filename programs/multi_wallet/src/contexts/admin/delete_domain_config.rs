use crate::state::DomainConfig;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DeleteDomainConfig<'info> {
    #[account(
        mut,
        close = authority,
    )]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        mut,
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> DeleteDomainConfig<'info> {
    pub fn process(_ctx: Context<Self>) -> Result<()> {
        Ok(())
    }
}

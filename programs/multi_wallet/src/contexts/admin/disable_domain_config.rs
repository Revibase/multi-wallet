use crate::{state::DomainConfig, ADMIN};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DisableDomainConfig<'info> {
    #[account(mut)]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        address = ADMIN
    )]
    pub admin: Signer<'info>,
}

impl<'info> DisableDomainConfig<'info> {
    pub fn process(ctx: Context<Self>, disable: bool) -> Result<()> {
        let domain_config = &mut ctx.accounts.domain_config.load_mut()?;
        domain_config.is_disabled = if disable { 1 } else { 0 };

        Ok(())
    }
}

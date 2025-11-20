use crate::state::DomainConfig;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DisableDomainConfig<'info> {
    #[account(mut)]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    pub admin: Signer<'info>,
}

impl<'info> DisableDomainConfig<'info> {
    pub fn process(ctx: Context<Self>, disable: bool) -> Result<()> {
        #[cfg(feature = "mainnet")]
        require!(
            ctx.accounts.admin.key().eq(&crate::ADMIN),
            crate::MultisigError::InvalidAccount
        );
        let domain_config = &mut ctx.accounts.domain_config.load_mut()?;
        domain_config.is_disabled = if disable { 1 } else { 0 };
        Ok(())
    }
}

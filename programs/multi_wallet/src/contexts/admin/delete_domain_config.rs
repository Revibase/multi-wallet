use crate::state::{DomainConfig, SEED_DOMAIN_CONFIG};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DeleteDomainConfig<'info> {
    #[account(
        mut,
        close = payer,
        seeds = [SEED_DOMAIN_CONFIG, domain_config.load()?.rp_id_hash.as_ref()],
        bump = domain_config.load()?.bump,
    )]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        mut,
        constraint = payer.key() == domain_config.load()?.authority,
    )]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> DeleteDomainConfig<'info> {
    pub fn process(_ctx: Context<Self>) -> Result<()> {
        Ok(())
    }
}

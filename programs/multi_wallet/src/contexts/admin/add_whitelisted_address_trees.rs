use crate::{
    state::{DomainConfig, WhitelistedAddressTree},
    utils::SEED_WHITELISTED_ADDRESS_TREE,
    ADMIN_DOMAIN_CONFIG,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AddWhitelistedAddressTrees<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = WhitelistedAddressTree::size(),
        seeds = [SEED_WHITELISTED_ADDRESS_TREE],
        bump,
    )]
    pub whitelisted_address_trees: Account<'info, WhitelistedAddressTree>,
    #[account(
        mut,
        address = admin_domain_config.load()?.authority,
    )]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        address = ADMIN_DOMAIN_CONFIG
    )]
    pub admin_domain_config: AccountLoader<'info, DomainConfig>,
}

impl<'info> AddWhitelistedAddressTrees<'info> {
    pub fn process(ctx: Context<Self>, address_tree: Pubkey) -> Result<()> {
        let account = &mut ctx.accounts.whitelisted_address_trees;
        account.whitelisted_address_trees.push(address_tree);
        account.bump = ctx.bumps.whitelisted_address_trees;

        Ok(())
    }
}

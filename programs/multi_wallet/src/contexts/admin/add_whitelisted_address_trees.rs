use crate::{state::WhitelistedAddressTree, utils::SEED_WHITELISTED_ADDRESS_TREE};
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
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> AddWhitelistedAddressTrees<'info> {
    pub fn process(ctx: Context<Self>, address_tree: Pubkey) -> Result<()> {
        #[cfg(feature = "mainnet")]
        require!(
            ctx.accounts.payer.key().eq(&crate::ADMIN),
            crate::MultisigError::InvalidAccount
        );
        let account = &mut ctx.accounts.whitelisted_address_trees;
        account.whitelisted_address_trees.push(address_tree);
        account.bump = ctx.bumps.whitelisted_address_trees;

        Ok(())
    }
}

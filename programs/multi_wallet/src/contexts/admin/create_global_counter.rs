use crate::state::{GlobalCounter, SEED_GLOBAL_COUNTER};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateGlobalCounter<'info> {
    #[account(
        init,
        payer = payer,
        space = GlobalCounter::size(),
        seeds = [SEED_GLOBAL_COUNTER],
        bump,
    )]
    pub global_counter: AccountLoader<'info, GlobalCounter>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CreateGlobalCounter<'info> {
    pub fn process(ctx: Context<Self>) -> Result<()> {
        #[cfg(feature = "mainnet")]
        require!(
            ctx.accounts.payer.key.eq(&crate::ADMIN),
            crate::error::MultisigError::InvalidAccount
        );

        ctx.accounts.global_counter.load_init()?.index = 1;
        Ok(())
    }
}

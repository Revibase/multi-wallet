use crate::{
    error::MultisigError,
    state::{DomainConfig, SEED_DOMAIN_CONFIG},
};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateDomainConfigArgs {
    rp_id_hash: [u8; 32],
    origin: String,
    authority: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: CreateDomainConfigArgs)]
pub struct CreateDomainConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = DomainConfig::size(),
        seeds = [SEED_DOMAIN_CONFIG, args.rp_id_hash.as_ref()],
        bump,
    )]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CreateDomainConfig<'info> {
    pub fn process(ctx: Context<Self>, args: CreateDomainConfigArgs) -> Result<()> {
        let domain_config = &mut ctx.accounts.domain_config.load_init()?;
        domain_config.rp_id_hash = args.rp_id_hash;
        domain_config.bump = ctx.bumps.domain_config;

        let origin = args.origin.as_bytes();
        require!(origin.len() < 256, MultisigError::MaxLengthExceeded);

        for i in 0..256 {
            if i < origin.len() {
                domain_config.origin[i] = *origin.get(i).unwrap();
            } else {
                domain_config.origin[i] = 0;
            }
        }
        domain_config.origin_length = origin.len().try_into().unwrap();
        domain_config.authority = args.authority;

        Ok(())
    }
}

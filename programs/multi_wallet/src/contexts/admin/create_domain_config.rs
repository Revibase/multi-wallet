use crate::{state::DomainConfig, utils::SEED_DOMAIN_CONFIG, ADMIN_DOMAIN_CONFIG};
use anchor_lang::prelude::*;
use light_hasher::{Hasher, Sha256};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateDomainConfigArgs {
    rp_id: String,
    origins: Vec<String>,
    authority: Pubkey,
    metadata_url: String,
}

#[derive(Accounts)]
#[instruction(args: CreateDomainConfigArgs)]
pub struct CreateDomainConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = DomainConfig::size(),
        seeds = [SEED_DOMAIN_CONFIG, {
            Sha256::hash(args.rp_id.as_bytes()).unwrap().as_ref()
        }],
        bump,
    )]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        // address = ADMIN_DOMAIN_CONFIG
    )]
    pub admin_domain_config: AccountLoader<'info, DomainConfig>,
}

impl<'info> CreateDomainConfig<'info> {
    pub fn process(ctx: Context<Self>, args: CreateDomainConfigArgs) -> Result<()> {
        #[cfg(feature = "mainnet")]
        require!(
            ctx.accounts
                .payer
                .key
                .eq(&ctx.accounts.admin_domain_config.load()?.authority),
            crate::error::MultisigError::InvalidAccount
        );

        let domain_config = &mut ctx.accounts.domain_config.load_init()?;
        domain_config.rp_id_hash = Sha256::hash(args.rp_id.as_bytes()).unwrap();

        domain_config.write_metadata_url(args.metadata_url)?;
        domain_config.write_rp_id(args.rp_id)?;
        domain_config.write_origins(args.origins)?;
        domain_config.authority = args.authority;
        domain_config.bump = ctx.bumps.domain_config;
        domain_config.is_disabled = 0;

        Ok(())
    }
}

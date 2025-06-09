use crate::{
    error::MultisigError,
    state::{DomainConfig, SEED_DOMAIN_CONFIG},
};
use anchor_lang::{prelude::*, solana_program::hash};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateDomainConfigArgs {
    rp_id: String,
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
        domain_config.rp_id_hash = hash::hash(args.rp_id.as_bytes()).to_bytes();
        let hash = hash::hash(args.rp_id.as_bytes());
        require!(
            hash.eq(&hash::Hash::new_from_array(args.rp_id_hash)),
            MultisigError::RpIdHashMismatch
        );

        let rp_id = args.rp_id.as_bytes();
        require!(rp_id.len() <= 256, MultisigError::MaxLengthExceeded);

        for i in 0..256 {
            if i < rp_id.len() {
                domain_config.rp_id[i] = *rp_id.get(i).unwrap();
            } else {
                domain_config.rp_id[i] = 0;
            }
        }
        domain_config.rp_id_length = rp_id.len().try_into().unwrap();

        let origin = args.origin.as_bytes();
        require!(origin.len() <= 512, MultisigError::MaxLengthExceeded);

        for i in 0..512 {
            if i < origin.len() {
                domain_config.origin[i] = *origin.get(i).unwrap();
            } else {
                domain_config.origin[i] = 0;
            }
        }
        domain_config.origin_length = origin.len().try_into().unwrap();
        domain_config.authority = args.authority;
        domain_config.bump = ctx.bumps.domain_config;
        domain_config.is_disabled = 0;

        Ok(())
    }
}

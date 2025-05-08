use crate::{error::MultisigError, state::DomainConfig};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct EditDomainConfigArgs {
    origin: String,
    authority: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: EditDomainConfigArgs)]
pub struct EditDomainConfig<'info> {
    #[account(mut)]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        constraint = authority.key() == domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> EditDomainConfig<'info> {
    pub fn process(ctx: Context<Self>, args: EditDomainConfigArgs) -> Result<()> {
        let domain_config = &mut ctx.accounts.domain_config.load_mut()?;
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

        Ok(())
    }
}

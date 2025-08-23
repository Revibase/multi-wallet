use crate::state::DomainConfig;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct EditDomainConfigArgs {
    new_origins: Option<Vec<String>>,
    new_authority: Option<Pubkey>,
}

#[derive(Accounts)]
#[instruction(args: EditDomainConfigArgs)]
pub struct EditDomainConfig<'info> {
    #[account(mut)]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> EditDomainConfig<'info> {
    pub fn process(ctx: Context<Self>, args: EditDomainConfigArgs) -> Result<()> {
        let domain_config = &mut ctx.accounts.domain_config.load_mut()?;
        if args.new_origins.is_some() {
            domain_config.write_origins(args.new_origins.unwrap())?;
        }
        if args.new_authority.is_some() {
            domain_config.authority = args.new_authority.unwrap();
        }

        Ok(())
    }
}

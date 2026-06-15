use crate::{
    error::MultisigError,
    state::{DomainConfig, User},
    utils::{MemberKey, UserRole, SEED_USER},
};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct EditDomainConfigArgs {
    new_origins: Option<Vec<String>>,
}

#[derive(Accounts)]
pub struct EditDomainConfig<'info> {
    #[account(mut)]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        mut,
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    pub new_authority: Option<Signer<'info>>,
    #[account(
        init,
        payer = authority,
        space = User::size(0, 0, 0, 0),
        seeds = [SEED_USER, {
            new_authority.as_ref().ok_or(MultisigError::MissingNewAuthority)?.key.as_ref()
        }],
        bump
    )]
    pub user_account: Option<Account<'info, User>>,
    pub system_program: Program<'info, System>,
}

impl<'info> EditDomainConfig<'info> {
    pub fn process(
        ctx: Context<'info, Self>,
        args: EditDomainConfigArgs,
    ) -> Result<()> {
        let domain_config = &mut ctx.accounts.domain_config.load_mut()?;

        if let Some(new_authority) = &mut ctx.accounts.new_authority {
            let user = &mut ctx
                .accounts
                .user_account
                .as_mut()
                .ok_or(MultisigError::MissingNewAuthority)?;
            user.member = MemberKey::convert_ed25519(&new_authority.key)?;
            user.role = UserRole::Administrator;
            user.wallets = Vec::new();
            user.transports = None;
            user.credential_id = None;
            user.domain_config = Some(ctx.accounts.domain_config.key());
            user.transaction_manager_url = None;
            user.bump = ctx
                .bumps
                .user_account
                .ok_or(MultisigError::MissingAccount)?;

            user.invariant()?;

            domain_config.authority = new_authority.key();
        }

        if let Some(new_origins) = args.new_origins {
            domain_config.write_origins(&new_origins)?;
        }

        Ok(())
    }
}

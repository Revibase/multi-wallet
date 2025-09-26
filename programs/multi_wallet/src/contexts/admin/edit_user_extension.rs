use crate::state::UserExtensions;
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct EditUserExtensionsArgs {
    pub api_url: String,
}

#[derive(Accounts)]
pub struct EditUserExtensions<'info> {
    #[account(
        address = user_extensions.load()?.authority
    )]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub user_extensions: AccountLoader<'info, UserExtensions>,
}

impl<'info> EditUserExtensions<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        args: EditUserExtensionsArgs,
    ) -> Result<()> {
        let mut user_extensions = ctx.accounts.user_extensions.load_mut()?;
        user_extensions.write_api_url(args.api_url)?;
        Ok(())
    }
}

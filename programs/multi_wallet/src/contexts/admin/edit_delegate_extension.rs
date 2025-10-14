use crate::state::DelegateExtensions;
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct EditDelegateExtensionsArgs {
    pub api_url: String,
}

#[derive(Accounts)]
pub struct EditDelegateExtensions<'info> {
    #[account(
        address = delegate_extensions.load()?.authority
    )]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub delegate_extensions: AccountLoader<'info, DelegateExtensions>,
}

impl<'info> EditDelegateExtensions<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        args: EditDelegateExtensionsArgs,
    ) -> Result<()> {
        let mut delegate_extensions = ctx.accounts.delegate_extensions.load_mut()?;
        delegate_extensions.write_api_url(args.api_url)?;
        Ok(())
    }
}

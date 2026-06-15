use crate::{
    error::MultisigError,
    state::User,
    utils::{UserRole, SEED_USER},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct EditTransactionManagerUrl<'info> {
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_USER, signer.key.as_ref()],
        bump = transaction_manager_account.bump
    )]
    pub transaction_manager_account: Account<'info, User>,
}

impl<'info> EditTransactionManagerUrl<'info> {
    pub fn process(
        ctx: Context<'info, Self>,
        transaction_manager_url: String,
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.transaction_manager_account;
        require!(
            user_account.role.eq(&UserRole::TransactionManager)
                && user_account.transaction_manager_url.is_some(),
            MultisigError::ExpectedTransactionManagerRoleMismatch
        );
        user_account.transaction_manager_url = Some(transaction_manager_url);

        user_account.invariant()?;

        Ok(())
    }
}

use crate::{
    error::MultisigError,
    state::{ProofArgs, User, UserMutArgs},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    LightAccount,
};

#[derive(Accounts)]
#[instruction(user_mut_args: UserMutArgs)]
pub struct EditTransactionManagerUrl<'info> {
    #[account(
        address = user_mut_args.data.member.to_pubkey()?
    )]
    pub authority: Signer<'info>,
}

impl<'info> EditTransactionManagerUrl<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        user_mut_args: UserMutArgs,
        transaction_manager_url: String,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.authority,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );
        let mut user_account = LightAccount::<User>::new_mut(
            &crate::ID,
            &user_mut_args.account_meta,
            user_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        require!(
            user_account.transaction_manager_url.is_some(),
            MultisigError::InvalidArguments
        );
        user_account.transaction_manager_url = Some(transaction_manager_url);

        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof)
            .with_light_account(user_account)?
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

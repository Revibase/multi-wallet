use crate::state::{Delegate, DelegateCreationArgs, ProofArgs};
use crate::{ADMIN, LIGHT_CPI_SIGNER};
use anchor_lang::prelude::*;
use light_sdk::cpi::v1::{CpiAccounts, LightSystemProgramCpi};
use light_sdk::cpi::{InvokeLightSystemProgram, LightCpiInstruction};

#[derive(Accounts)]
pub struct MigrateCompressedDelegates<'info> {
    #[account(
        mut,
        address = ADMIN,
    )]
    pub authority: Signer<'info>,
}

impl<'info> MigrateCompressedDelegates<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        args: Delegate,
        compressed_proof_args: ProofArgs,
        delegate_creation_args: DelegateCreationArgs,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.authority,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let (account_info, new_address_params) = Delegate::create_delegate_account(
            delegate_creation_args,
            &light_cpi_accounts,
            args,
            0,
        )?;

        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof)
            .with_light_account(account_info)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

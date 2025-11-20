use crate::state::{ProofArgs, User, UserCreationArgs};
use crate::{ADMIN, LIGHT_CPI_SIGNER};
use anchor_lang::prelude::*;
use light_sdk::cpi::v2::{CpiAccounts, LightSystemProgramCpi};
use light_sdk::cpi::{InvokeLightSystemProgram, LightCpiInstruction};
use light_sdk::instruction::ValidityProof;

#[derive(Accounts)]
pub struct MigrateCompressedUser<'info> {
    #[account(
        mut,
        address = ADMIN,
    )]
    pub authority: Signer<'info>,
}

impl<'info> MigrateCompressedUser<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        args: User,
        compressed_proof_args: ProofArgs,
        user_creation_args: UserCreationArgs,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.authority,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let address_tree = &user_creation_args
            .address_tree_info
            .get_tree_pubkey(&light_cpi_accounts)
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let (account_info, new_address_params) =
            User::create_user_account(user_creation_args, address_tree, args, Some(0))?;

        account_info.invariant()?;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(account_info)?
        .with_new_addresses(&[new_address_params])
        .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

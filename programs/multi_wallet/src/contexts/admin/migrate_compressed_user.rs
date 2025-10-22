use crate::state::{DomainConfig, ProofArgs, User, UserCreationArgs};
use crate::{ADMIN_DOMAIN_CONFIG, LIGHT_CPI_SIGNER};
use anchor_lang::prelude::*;
use light_sdk::cpi::v1::{CpiAccounts, LightSystemProgramCpi};
use light_sdk::cpi::{InvokeLightSystemProgram, LightCpiInstruction};

#[derive(Accounts)]
pub struct MigrateCompressedUser<'info> {
    #[account(
        mut,
        address = admin_domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    #[account(
        address = ADMIN_DOMAIN_CONFIG
    )]
    pub admin_domain_config: AccountLoader<'info, DomainConfig>,
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

        let (account_info, new_address_params) =
            User::create_user_account(user_creation_args, &light_cpi_accounts, args)?;

        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof)
            .with_light_account(account_info)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

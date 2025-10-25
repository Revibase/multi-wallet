use crate::state::{
    CompressedSettings, CompressedSettingsData, DomainConfig, ProofArgs, SettingsCreationArgs,
};
use crate::{ADMIN_DOMAIN_CONFIG, LIGHT_CPI_SIGNER};
use anchor_lang::prelude::*;
use light_sdk::cpi::v2::{CpiAccounts, LightSystemProgramCpi};
use light_sdk::cpi::{InvokeLightSystemProgram, LightCpiInstruction};

#[derive(Accounts)]
pub struct MigrateCompressedSettings<'info> {
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

impl<'info> MigrateCompressedSettings<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        args: CompressedSettingsData,
        compressed_proof_args: ProofArgs,
        settings_creation_args: SettingsCreationArgs,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.authority,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let (settings_account, settings_new_address) =
            CompressedSettings::create_compressed_settings_account(
                settings_creation_args,
                args,
                &light_cpi_accounts,
                Some(0),
            )?;

        settings_account.invariant()?;

        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof)
            .with_light_account(settings_account)?
            .with_new_addresses(&[settings_new_address])
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

use crate::{
    state::{Settings, SettingsCloseArgs, SEED_MULTISIG, SEED_VAULT},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    cpi::{CpiAccounts, CpiInputs},
};
use std::vec;

#[derive(Accounts)]
#[instruction(settings_close_args: SettingsCloseArgs)]
pub struct DecompressSettingsAccount<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(settings_close_args.settings.members.len()), 
        seeds = [
            SEED_MULTISIG,  
            settings_close_args.settings.index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub settings_account: Account<'info, Settings>,
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,
            settings_account.key().as_ref(),
            SEED_VAULT,
        ],
        bump = settings_close_args.settings.multi_wallet_bump
    )]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> DecompressSettingsAccount<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        settings_close_args: SettingsCloseArgs,
    ) -> Result<()> {
        let current_settings = LightAccount::<'_, Settings>::new_close(
            &crate::ID,
            &settings_close_args.account_meta,
            settings_close_args.settings.clone(),
        )
        .map_err(ProgramError::from)?;

        let settings = &mut ctx.accounts.settings_account;
        settings.threshold = current_settings.threshold;
        settings.multi_wallet_bump = current_settings.multi_wallet_bump;
        settings.bump = ctx.bumps.settings_account;
        settings.index = current_settings.index;
        settings.members = current_settings.members.clone();
        settings.invariant()?;

        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.payer.as_ref(),
            ctx.remaining_accounts,
            LIGHT_CPI_SIGNER,
        );

        let cpi_inputs = CpiInputs::new(
            settings_close_args.proof,
            vec![current_settings.to_account_info().map_err(ProgramError::from)?],
        );

        cpi_inputs
            .invoke_light_system_program(light_cpi_accounts)
            .map_err(ProgramError::from)?;

        Ok(())
    }
}

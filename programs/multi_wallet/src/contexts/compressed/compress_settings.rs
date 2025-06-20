use crate::{
    state::{Settings, SettingsCreationArgs, SEED_MULTISIG, SEED_VAULT},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{CpiAccounts, CpiInputs},
};
use std::vec;

#[derive(Accounts)]
pub struct CompressSettingsAccount<'info> {
    #[account(
        mut,
        close = rent_collector,
    )]
    pub settings: Account<'info, Settings>,
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_VAULT,
        ],
        bump = settings.multi_wallet_bump
    )]
    pub authority: Signer<'info>,
    /// CHECK:
    #[account(mut)]
    pub rent_collector: UncheckedAccount<'info>,
}

impl<'info> CompressSettingsAccount<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        settings_creation_args: SettingsCreationArgs,
    ) -> Result<()> {
        let current_settings = &ctx.accounts.settings;
        let payer = ctx.accounts.authority.to_account_info();
        let light_cpi_accounts =
            CpiAccounts::new(&payer, &ctx.remaining_accounts, LIGHT_CPI_SIGNER);

        let (address, address_seed) = derive_address(
            &[SEED_MULTISIG, current_settings.index.to_le_bytes().as_ref()],
            &settings_creation_args
                .address_tree_info
                .get_tree_pubkey(&light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
            &crate::ID,
        );

        let new_address_params = settings_creation_args
            .address_tree_info
            .into_new_address_params_packed(address_seed);

        let mut settings_account = LightAccount::<'_, Settings>::new_init(
            &crate::ID,
            Some(address),
            settings_creation_args.output_state_tree_index,
        );
        settings_account.threshold = current_settings.threshold;
        settings_account.multi_wallet_bump = current_settings.multi_wallet_bump;
        settings_account.bump = current_settings.bump;
        settings_account.index = current_settings.index;
        settings_account.members = current_settings.members.clone();
        settings_account.invariant()?;

        let cpi = CpiInputs::new_with_address(
            settings_creation_args.proof,
            vec![settings_account
                .to_account_info()
                .map_err(ProgramError::from)?],
            vec![new_address_params],
        );

        cpi.invoke_light_system_program(light_cpi_accounts)
            .map_err(ProgramError::from)?;
        Ok(())
    }
}

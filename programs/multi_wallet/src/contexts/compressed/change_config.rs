use crate::{
    error::MultisigError,
    state::{Delegate, DelegateOp, Settings, SettingsArgs, SEED_MULTISIG, SEED_VAULT},
    ConfigAction, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    account::LightAccount,
    cpi::{CpiAccounts, CpiInputs},
};
use std::vec;

#[derive(Accounts)]
pub struct ChangeConfigCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl<'info> ChangeConfigCompressed<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        config_actions: Vec<ConfigAction>,
        settings_args: SettingsArgs,
    ) -> Result<()> {
        let slot_hash_sysvar = &ctx.accounts.slot_hash_sysvar;
        let instructions_sysvar = &ctx.accounts.instructions_sysvar;
        let mut settings = LightAccount::<'_, Settings>::new_mut(
            &crate::ID,
            &settings_args.account_meta,
            settings_args.settings,
        )
        .map_err(ProgramError::from)?;
        let settings_key = Pubkey::new_from_array(settings.address().unwrap());
        let payer = &ctx.accounts.payer;
        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];
        let multi_wallet_key = Pubkey::create_program_address(signer_seeds, &crate::ID).unwrap();
        require!(
            multi_wallet_key.eq(&payer.key()),
            MultisigError::InvalidAccount
        );

        let remaining_accounts = ctx.remaining_accounts;

        let mut delegate_ops: Vec<DelegateOp> = vec![];
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    settings.edit_permissions(members);
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(
                        &settings_key,
                        members,
                        remaining_accounts,
                        slot_hash_sysvar,
                        instructions_sysvar,
                    )?;
                    delegate_ops.extend(ops.into_iter().map(DelegateOp::Create));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    delegate_ops.extend(ops.into_iter().map(DelegateOp::Close));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold);
                }
            }
        }

        Delegate::handle_delegate_accounts(delegate_ops, settings_key, payer, remaining_accounts)?;

        settings.invariant()?;

        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.payer.as_ref(),
            ctx.remaining_accounts,
            LIGHT_CPI_SIGNER,
        );

        let cpi_inputs = CpiInputs::new(
            settings_args.proof,
            vec![settings.to_account_info().map_err(ProgramError::from)?],
        );
        cpi_inputs
            .invoke_light_system_program(light_cpi_accounts)
            .map_err(ProgramError::from)?;

        Ok(())
    }
}

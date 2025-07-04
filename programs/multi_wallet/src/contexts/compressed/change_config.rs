use crate::{
    state::{
        invoke_light_system_program_with_payer_seeds, CompressedSettings, Delegate, DelegateOp,
        ProofArgs, Settings, SettingsMutArgs, SEED_MULTISIG, SEED_VAULT,
    },
    ConfigAction, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_compressed_account::instruction_data::with_account_info::CompressedAccountInfo;
use light_sdk::{
    account::LightAccount,
    cpi::{CpiAccounts, CpiInputs},
};
use std::vec;

#[derive(Accounts)]
#[instruction(config_actions: Vec<ConfigAction>,settings_args: SettingsMutArgs,)]
pub struct ChangeConfigCompressed<'info> {
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,
            {Settings::get_settings_key_from_index(settings_args.data.index, settings_args.data.bump)?.as_ref()},
            SEED_VAULT,
        ],
        bump = settings_args.data.multi_wallet_bump
    )]
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
        settings_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let slot_hash_sysvar = &ctx.accounts.slot_hash_sysvar;
        let instructions_sysvar = &ctx.accounts.instructions_sysvar;
        let mut settings = LightAccount::<'_, CompressedSettings>::new_mut(
            &crate::ID,
            &settings_args.account_meta,
            settings_args.data,
        )
        .map_err(ProgramError::from)?;
        let settings_index = settings.index;
        let settings_key = Settings::get_settings_key_from_index(settings_index, settings.bump)?;
        let multi_wallet_bump = settings.multi_wallet_bump;
        let payer: &Signer<'info> = &ctx.accounts.payer;
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
        settings.invariant()?;

        let mut account_infos = vec![];
        let mut new_addresses = vec![];

        let light_cpi_accounts = CpiAccounts::new(
            &payer,
            &remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let (create_args, close_args) =
            Delegate::handle_delegate_accounts(delegate_ops, settings_index, &light_cpi_accounts)?;

        if create_args.len() > 0 || close_args.len() > 0 {
            account_infos.extend(
                create_args
                    .iter()
                    .map(|f| f.0.clone())
                    .collect::<Vec<CompressedAccountInfo>>(),
            );
            new_addresses = create_args.iter().map(|f| f.1).collect();
            account_infos.extend(close_args);
        }
        account_infos.push(settings.to_account_info().map_err(ProgramError::from)?);
        if account_infos.len() > 0 || new_addresses.len() > 0 {
            let cpi_inputs = if new_addresses.is_empty() {
                CpiInputs::new(compressed_proof_args.proof, account_infos)
            } else {
                CpiInputs::new_with_address(
                    compressed_proof_args.proof,
                    account_infos,
                    new_addresses,
                )
            };
            let vault_signer_seed: &[&[u8]] = &[
                SEED_MULTISIG,
                settings_key.as_ref(),
                SEED_VAULT,
                &[multi_wallet_bump],
            ];
            invoke_light_system_program_with_payer_seeds(
                cpi_inputs,
                light_cpi_accounts,
                vault_signer_seed,
            )?;
        }

        Ok(())
    }
}

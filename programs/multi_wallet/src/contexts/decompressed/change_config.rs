use crate::{
    error::MultisigError,
    state::{
        invoke_light_system_program_with_payer_seeds, Delegate, DelegateOp, ProofArgs, Settings,
        SEED_MULTISIG, SEED_VAULT,
    },
    utils::realloc_if_needed,
    ConfigAction, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_compressed_account::instruction_data::data::NewAddressParamsPacked;
use light_compressed_account::instruction_data::with_account_info::CompressedAccountInfo;
use light_sdk::cpi::{CpiAccounts, CpiInputs};
use std::vec;

#[derive(Accounts)]
pub struct ChangeConfig<'info> {
    #[account(mut)]
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
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
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

impl<'info> ChangeConfig<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        config_actions: Vec<ConfigAction>,
        compressed_proof_args: Option<ProofArgs>,
    ) -> Result<()> {
        let slot_hash_sysvar = &ctx.accounts.slot_hash_sysvar;
        let instructions_sysvar = &ctx.accounts.instructions_sysvar;
        let settings = &mut ctx.accounts.settings;
        let payer = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let settings_account_info = settings.to_account_info();
        let current_size = settings_account_info.data_len();
        let settings_key = settings_account_info.key();

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

        if !delegate_ops.is_empty() {
            let proof_args = compressed_proof_args.ok_or(MultisigError::MissingDelegateArgs)?;
            let light_cpi_accounts = CpiAccounts::new(
                &payer,
                &remaining_accounts[proof_args.light_cpi_accounts_start_index as usize..],
                LIGHT_CPI_SIGNER,
            );
            let (create_args, close_args) = Delegate::handle_delegate_accounts(
                delegate_ops,
                settings.index,
                &light_cpi_accounts,
            )?;

            if create_args.len() > 0 || close_args.len() > 0 {
                let mut account_infos = vec![];
                let new_addresses: Vec<NewAddressParamsPacked> =
                    create_args.iter().map(|f| f.1).collect();
                account_infos.extend(
                    create_args
                        .iter()
                        .map(|f| f.0.clone())
                        .collect::<Vec<CompressedAccountInfo>>(),
                );
                account_infos.extend(close_args);

                let cpi_inputs = if new_addresses.is_empty() {
                    CpiInputs::new(proof_args.proof, account_infos)
                } else {
                    CpiInputs::new_with_address(proof_args.proof, account_infos, new_addresses)
                };
                let vault_signer_seed: &[&[u8]] = &[
                    SEED_MULTISIG,
                    settings_key.as_ref(),
                    SEED_VAULT,
                    &[settings.multi_wallet_bump],
                ];
                invoke_light_system_program_with_payer_seeds(
                    cpi_inputs,
                    light_cpi_accounts,
                    vault_signer_seed,
                )?;
            }
        }

        realloc_if_needed(
            &settings.to_account_info(),
            current_size,
            Settings::size(settings.members.len()),
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;

        Ok(())
    }
}

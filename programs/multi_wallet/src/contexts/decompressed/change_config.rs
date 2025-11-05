use crate::{
    ConfigAction, LIGHT_CPI_SIGNER, error::MultisigError, state::{Ops, ProofArgs, Settings, SettingsIndexWithAddress, User}, utils::{SEED_MULTISIG, SEED_VAULT}
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        InvokeLightSystemProgram, LightCpiInstruction, v2::{CpiAccounts, LightSystemProgramCpi}
    }, instruction::ValidityProof,
};
use std::vec;

#[derive(Accounts)]
#[instruction(settings_index: u128)]
pub struct ChangeConfig<'info> {
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,  
            settings_index.to_le_bytes().as_ref()
        ],
        bump = settings.load()?.bump
    )]
    pub settings: AccountLoader<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    #[account(
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_VAULT,
        ],
        bump = settings.load()?.multi_wallet_bump
    )]
    pub authority: Signer<'info>,
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
        _settings_index: u128,
        config_actions: Vec<ConfigAction>,
        compressed_proof_args: Option<ProofArgs>,
    ) -> Result<()> {
        let slot_hash_sysvar = &ctx.accounts.slot_hash_sysvar;
        let instructions_sysvar = &ctx.accounts.instructions_sysvar;
        let settings = &mut ctx.accounts.settings.load_mut()?;
        let payer = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let mut delegate_ops: Vec<Ops> = vec![];
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    let ops = settings.edit_permissions(members)?;
                    delegate_ops.extend(ops.0.into_iter().map(Ops::Add));
                    delegate_ops.extend(ops.1.into_iter().map(Ops::Remove));
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(
                        &ctx.accounts.settings.key(),
                        members,
                        remaining_accounts,
                        slot_hash_sysvar,
                        instructions_sysvar.as_ref(),
                    )?;
                    delegate_ops.extend(ops.into_iter().map(Ops::Add));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    delegate_ops.extend(ops.into_iter().map(Ops::Remove));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold)?;
                }
            }
        }
        settings.invariant()?;

        if !delegate_ops.is_empty() {
            let compressed_proof_args = compressed_proof_args.ok_or(MultisigError::InvalidArguments)?;
            let light_cpi_accounts = CpiAccounts::new(
                &payer,
                &remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
                LIGHT_CPI_SIGNER,
            );
            let account_infos = User::handle_user_delegates(
                delegate_ops, 
                SettingsIndexWithAddress{ index:settings.index, settings_address_tree_index: settings.settings_address_tree_index },
                &light_cpi_accounts)?;

       
            let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, ValidityProof(compressed_proof_args.proof));

            for f in account_infos {
                cpi = cpi.with_light_account(f)?;
            }

            cpi.invoke(light_cpi_accounts)?;

        }

        Ok(())
    }
}

use crate::{
    error::MultisigError,
    state::{
        CompressedSettings, Member, MemberKeyWithRemovePermissionsArgs,
        MemberWithAddPermissionsArgs, Ops, ProofArgs, Settings, SettingsMutArgs, User,
        SEED_MULTISIG, SEED_VAULT,
    },
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
    pub authority: Signer<'info>,
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
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let slot_hash_sysvar = &ctx.accounts.slot_hash_sysvar;
        let mut settings: LightAccount<'_, CompressedSettings> =
            LightAccount::<'_, CompressedSettings>::new_mut(
                &crate::ID,
                &settings_mut_args.account_meta,
                settings_mut_args.data,
            )
            .map_err(ProgramError::from)?;

        let settings_data = settings
            .data
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;

        let settings_index = settings_data.index;
        let settings_key =
            Settings::get_settings_key_from_index(settings_index, settings_data.bump)?;

        let vault_signer_seed: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings_data.multi_wallet_bump],
        ];
        let multi_wallet = Pubkey::create_program_address(vault_signer_seed, &crate::id()).unwrap();
        require!(
            ctx.accounts.authority.key().eq(&multi_wallet),
            MultisigError::InvalidAccount
        );

        let payer: &Signer<'info> = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let mut delegate_ops: Vec<Ops> = vec![];
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    let ops = settings.edit_permissions(members)?;
                    delegate_ops.extend(ops.0.into_iter().map(|f| {
                        Ops::Create(Box::new(MemberWithAddPermissionsArgs {
                            data: Member {
                                pubkey: f.pubkey,
                                permissions: f.permissions,
                                domain_config: Pubkey::default(),
                            },
                            verify_args: None,
                            user_delegate_creation_args: f.user_delegate_creation_args,
                        }))
                    }));
                    delegate_ops.extend(ops.1.into_iter().map(|f| {
                        Ops::Close(Box::new(MemberKeyWithRemovePermissionsArgs {
                            data: f.pubkey,
                            user_delegate_close_args: f.user_delegate_close_args,
                        }))
                    }));
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(
                        &settings_key,
                        members,
                        remaining_accounts,
                        slot_hash_sysvar,
                        ctx.accounts.instructions_sysvar.as_ref(),
                    )?;
                    delegate_ops.extend(ops.into_iter().map(|op| Ops::Create(Box::new(op))));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    delegate_ops.extend(ops.into_iter().map(|op| Ops::Close(Box::new(op))));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold)?;
                }
            }
        }
        settings.invariant()?;

        let light_cpi_accounts = CpiAccounts::new(
            &payer,
            &remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let mut account_infos = User::handle_user_delegate_accounts(delegate_ops, settings_index)?;
        account_infos.insert(0, settings.to_account_info().map_err(ProgramError::from)?);

        if account_infos.len() > 0 {
            let cpi_inputs = CpiInputs::new(compressed_proof_args.proof, account_infos);
            cpi_inputs
                .invoke_light_system_program(light_cpi_accounts)
                .unwrap();
        }

        Ok(())
    }
}

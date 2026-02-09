use crate::{
    error::MultisigError,
    state::{ProofArgs, Settings, SettingsIndexWithAddress, User, UserWalletOperation},
    utils::TransactionSyncSigners,
    utils::{resize_account_if_necessary, MultisigSettings, TransactionActionType},
    ConfigAction, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
};
use std::vec;

#[derive(Accounts)]
pub struct ChangeConfig<'info> {
    #[account(mut)]
    pub settings: Account<'info, Settings>,
    #[account(mut)]
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
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> ChangeConfig<'info> {
    fn validate(
        &self,
        ctx: &Context<'_, '_, 'info, 'info, Self>,
        config_actions: &Vec<ConfigAction>,
        signers: &Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let Self {
            settings,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        let mut writer = Vec::new();
        config_actions.serialize(&mut writer)?;
        let message_hash =
            Sha256::hash(&writer).map_err(|_| MultisigError::HashComputationFailed)?;

        TransactionSyncSigners::verify(
            signers,
            ctx.remaining_accounts,
            instructions_sysvar,
            slot_hash_sysvar,
            settings.get_members()?,
            settings.get_threshold()?,
            ctx.accounts.settings.key(),
            message_hash,
            TransactionActionType::ChangeConfig,
        )?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &config_actions, &signers))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        config_actions: Vec<ConfigAction>,
        signers: Vec<TransactionSyncSigners>,
        compressed_proof_args: Option<ProofArgs>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let payer = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let mut wallet_operations: Vec<UserWalletOperation> = vec![];
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    settings.edit_permissions(members)?;
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(members)?;
                    wallet_operations.extend(ops.into_iter().map(UserWalletOperation::Add));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    wallet_operations.extend(ops.into_iter().map(UserWalletOperation::Remove));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold)?;
                }
            }
        }

        resize_account_if_necessary(
            settings.as_ref(),
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            Settings::size(settings.get_members()?.len()),
        )?;

        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        if !wallet_operations.is_empty() {
            let compressed_proof_args =
                compressed_proof_args.ok_or(MultisigError::MissingCompressedProofArgs)?;
            let light_cpi_accounts = CpiAccounts::new(
                &payer,
                &remaining_accounts
                    [compressed_proof_args.light_cpi_accounts_start_index as usize..],
                LIGHT_CPI_SIGNER,
            );
            let account_infos = User::process_user_wallet_operations(
                wallet_operations,
                SettingsIndexWithAddress {
                    index: settings.index,
                    settings_address_tree_index: settings.settings_address_tree_index,
                },
                &light_cpi_accounts,
            )?;

            let mut cpi = LightSystemProgramCpi::new_cpi(
                LIGHT_CPI_SIGNER,
                ValidityProof(compressed_proof_args.proof),
            );

            for user_account in account_infos {
                user_account.invariant()?;
                cpi = cpi.with_light_account(user_account)?;
            }

            cpi.invoke(light_cpi_accounts)?;
        }

        Ok(())
    }
}

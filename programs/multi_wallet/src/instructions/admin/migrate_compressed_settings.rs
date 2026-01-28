use crate::state::{CompressedSettings, CompressedSettingsData, ProofArgs, SettingsCreationArgs};
use crate::utils::{SEED_MULTISIG, SEED_VAULT};
use crate::{id, ADMIN, LIGHT_CPI_SIGNER};
use anchor_lang::prelude::*;
use light_sdk::cpi::v2::{CpiAccounts, LightSystemProgramCpi};
use light_sdk::cpi::{InvokeLightSystemProgram, LightCpiInstruction};
use light_sdk::instruction::ValidityProof;
use light_sdk::PackedAddressTreeInfoExt;

#[derive(Accounts)]
pub struct MigrateCompressedSettings<'info> {
    #[account(
        mut,
        address = ADMIN,
    )]
    pub authority: Signer<'info>,
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

        let address_tree = PackedAddressTreeInfoExt::get_tree_pubkey(
            &settings_creation_args.address_tree_info,
            &light_cpi_accounts,
        )
        .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let (settings_key, bump) = Pubkey::find_program_address(
            &[SEED_MULTISIG, args.index.to_le_bytes().as_ref()],
            &crate::ID,
        );

        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[SEED_MULTISIG, settings_key.as_ref(), SEED_VAULT],
            &id(),
        );

        let (settings_account, settings_new_address) =
            CompressedSettings::create_compressed_settings_account(
                settings_creation_args,
                &address_tree,
                CompressedSettingsData {
                    index: args.index,
                    members: args.members,
                    threshold: args.threshold,
                    multi_wallet_bump,
                    bump,
                    settings_address_tree_index: 0,
                    latest_slot_number: 0,
                },
                Some(0),
            )?;

        settings_account.invariant()?;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .with_new_addresses(&[settings_new_address])
        .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

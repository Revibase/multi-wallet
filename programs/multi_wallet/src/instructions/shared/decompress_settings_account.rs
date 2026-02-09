use crate::{
    utils::TransactionSyncSigners,
    utils::{MultisigSettings, MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS},
    CompressedSettings, MultisigError, ProofArgs, Settings, SettingsMutArgs, TransactionActionType,
    LIGHT_CPI_SIGNER, SEED_MULTISIG,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
    LightAccount,
};
use std::vec;

#[derive(Accounts)]
#[instruction(settings_mut_args: SettingsMutArgs)]
pub struct DecompressSettingsAccount<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS), 
        seeds = [
            SEED_MULTISIG,  
            settings_mut_args.data.data.as_ref().ok_or(MultisigError::MissingSettingsData)?.index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub settings: Account<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
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

impl<'info> DecompressSettingsAccount<'info> {
    fn validate(
        &self,
        remaining_accounts: &'info [AccountInfo<'info>],
        signers: &[TransactionSyncSigners],
        settings_mut_args: &SettingsMutArgs,
    ) -> Result<()> {
        let Self {
            settings,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = &self;

        let settings_data = settings_mut_args
            .data
            .data
            .as_ref()
            .ok_or(MultisigError::MissingSettingsData)?;

        let message_hash = Sha256::hash(&settings.key().to_bytes())
            .map_err(|_| MultisigError::HashComputationFailed)?;

        TransactionSyncSigners::verify(
            signers,
            remaining_accounts,
            instructions_sysvar,
            slot_hash_sysvar,
            &settings_data.members,
            settings_data.threshold,
            settings.key(),
            message_hash,
            TransactionActionType::Decompress,
        )?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx.remaining_accounts, &signers, &settings_mut_args))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;

        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.payer.as_ref(),
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let mut settings_account = LightAccount::<CompressedSettings>::new_mut(
            &crate::ID,
            &settings_mut_args.account_meta,
            settings_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        let settings_data = settings_account
            .data
            .as_ref()
            .ok_or(MultisigError::MissingSettingsData)?;
        settings.set_threshold(settings_data.threshold)?;
        settings.set_members(settings_data.members.clone())?;
        settings.set_latest_slot_number(settings_data.latest_slot_number)?;
        settings.multi_wallet_bump = settings_data.multi_wallet_bump;
        settings.bump = ctx.bumps.settings;
        settings.index = settings_data.index;
        settings.settings_address_tree_index = settings_data.settings_address_tree_index;

        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;
        settings.invariant()?;

        settings_account.data = None;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

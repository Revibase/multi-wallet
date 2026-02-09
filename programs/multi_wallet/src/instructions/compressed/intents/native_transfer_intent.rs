use crate::{
    state::{Settings, SettingsMutArgs},
    utils::TransactionSyncSigners,
    CompressedSettings, CompressedSettingsData, MultisigError, ProofArgs, TransactionActionType,
    LIGHT_CPI_SIGNER, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::SysvarId,
    system_program::{transfer, Transfer},
};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
    LightAccount,
};

#[derive(Accounts)]
pub struct NativeTransferIntentCompressed<'info> {
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
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: checked in instruction
    #[account(mut)]
    pub source: UncheckedAccount<'info>,

    /// CHECK:
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> NativeTransferIntentCompressed<'info> {
    fn validate(
        &self,
        amount: u64,
        remaining_accounts: &'info [AccountInfo<'info>],
        signers: &Vec<TransactionSyncSigners>,
        settings: &CompressedSettingsData,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            system_program,
            destination,
            ..
        } = &self;

        let mut buffer = vec![];
        buffer.extend_from_slice(amount.to_le_bytes().as_ref());
        buffer.extend_from_slice(destination.key().as_ref());
        buffer.extend_from_slice(system_program.key().as_ref());
        let message_hash =
            Sha256::hash(&buffer).map_err(|_| MultisigError::HashComputationFailed)?;

        TransactionSyncSigners::verify(
            signers,
            remaining_accounts,
            instructions_sysvar,
            slot_hash_sysvar,
            &settings.members,
            settings.threshold,
            system_program.key(),
            message_hash,
            TransactionActionType::TransferIntent,
        )?;

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        amount: u64,
        signers: Vec<TransactionSyncSigners>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
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

        let settings_key = Settings::get_settings_key_from_index_with_bump(
            settings_data.index,
            settings_data.bump,
        )?;

        ctx.accounts
            .validate(amount, ctx.remaining_accounts, &signers, &settings_data)?;

        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings_data.multi_wallet_bump],
        ];

        let multi_wallet = Pubkey::create_program_address(signer_seeds, &crate::id())
            .map_err(ProgramError::from)?;
        require!(
            ctx.accounts.source.key().eq(&multi_wallet),
            MultisigError::SourceAccountMismatch
        );

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            amount,
        )?;

        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings_account.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings_account.invariant()?;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

use crate::{
    state::{Settings, SettingsMutArgs},
    utils::{MultisigSettings, TransactionBufferSigners},
    CompressedSettings, DomainConfig, MemberKey, MultisigError, ProofArgs, Secp256r1VerifyArgs,
    TransactionBuffer, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    LightAccount,
};

#[derive(Accounts)]
pub struct TransactionBufferExecuteCompressed<'info> {
    #[account(
        mut,
        address = transaction_buffer.payer
    )]
    pub payer: Signer<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    pub executor: Option<Signer<'info>>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
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

impl<'info> TransactionBufferExecuteCompressed<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: &ProofArgs,
    ) -> Result<()> {
        let Self {
            transaction_buffer,
            executor,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            payer,
            ..
        } = self;

        let start_index = compressed_proof_args.light_cpi_accounts_start_index as usize;
        require!(
            start_index <= remaining_accounts.len(),
            MultisigError::InvalidNumberOfAccounts
        );
        let light_cpi_accounts =
            CpiAccounts::new(payer, &remaining_accounts[start_index..], LIGHT_CPI_SIGNER);

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

        require!(
            settings_key.eq(&transaction_buffer.multi_wallet_settings),
            MultisigError::SettingsKeyMismatch
        );
        let members = settings_account.get_members()?;
        if transaction_buffer.preauthorize_execution {
            let vote_count = members
                .iter()
                .filter(|x| {
                    x.permissions.has(crate::Permission::VoteTransaction)
                        && (transaction_buffer.voters.contains(&x.pubkey))
                })
                .count();

            require!(
                vote_count >= settings_account.get_threshold()? as usize,
                MultisigError::InsufficientSignersWithVotePermission
            );
            return Ok(());
        }

        TransactionBufferSigners::verify_execute(
            executor,
            secp256r1_verify_args,
            instructions_sysvar,
            slot_hash_sysvar,
            domain_config,
            members,
            settings_account.get_threshold()?,
            transaction_buffer.multi_wallet_settings,
            transaction_buffer.final_buffer_hash,
            transaction_buffer.voters.as_ref(),
            transaction_buffer.expected_signers.as_ref(),
        )?;

        let slot_numbers = TransactionBufferSigners::collect_slot_numbers(&secp256r1_verify_args);
        settings_account.latest_slot_number_check(&slot_numbers, &slot_hash_sysvar)?;
        settings_account.invariant()?;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .invoke(light_cpi_accounts)?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(ctx.remaining_accounts,&secp256r1_verify_args,settings_mut_args,&compressed_proof_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        if !transaction_buffer.preauthorize_execution {
            let signer = MemberKey::get_signer(
                &ctx.accounts.executor,
                &secp256r1_verify_args,
                ctx.accounts.instructions_sysvar.as_ref(),
            )?;
            ctx.accounts.transaction_buffer.add_executor(signer)?;
        }

        ctx.accounts.transaction_buffer.execute()?;
        Ok(())
    }
}

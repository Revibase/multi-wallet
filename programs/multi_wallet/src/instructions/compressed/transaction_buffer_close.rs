use crate::{
    state::{Settings, SettingsMutArgs},
    ChallengeArgs, CompressedSettings, DomainConfig, KeyType, MemberKey, MultisigError, ProofArgs,
    Secp256r1VerifyArgs, TransactionActionType, TransactionBuffer, LIGHT_CPI_SIGNER,
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
pub struct TransactionBufferCloseCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    #[account(
        mut,
        address = transaction_buffer.payer
    )]
    pub rent_collector: UncheckedAccount<'info>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        mut,
        close = rent_collector,
    )]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
    pub closer: Option<Signer<'info>>,
    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl<'info> TransactionBufferCloseCompressed<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: &ProofArgs,
    ) -> Result<()> {
        let Self {
            closer,
            transaction_buffer,
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
        let signer =
            MemberKey::get_signer(closer, secp256r1_verify_args, instructions_sysvar.as_ref())?;

        // allow rent payer to become the closer after transaction has expired
        if !(Clock::get()?.unix_timestamp as u64 > transaction_buffer.valid_till
            && signer.get_type().eq(&KeyType::Ed25519)
            && MemberKey::convert_ed25519(&transaction_buffer.payer)?.eq(&signer))
        {
            require!(
                transaction_buffer.creator.eq(&signer),
                MultisigError::UnauthorisedToCloseTransactionBuffer
            );
            if signer.get_type().eq(&KeyType::Secp256r1) {
                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                let instructions_sysvar = instructions_sysvar
                    .as_ref()
                    .ok_or(MultisigError::MissingInstructionsSysvar)?;

                secp256r1_verify_data.verify_webauthn(
                    slot_hash_sysvar,
                    domain_config,
                    instructions_sysvar,
                    ChallengeArgs {
                        account: transaction_buffer.multi_wallet_settings,
                        message_hash: transaction_buffer.final_buffer_hash,
                        action_type: TransactionActionType::Close,
                    },
                    transaction_buffer.expected_secp256r1_signers.as_ref(),
                )?;

                settings_account.latest_slot_number_check(
                    &[secp256r1_verify_data.slot_number],
                    &slot_hash_sysvar,
                )?;
            }
        }

        settings_account.invariant()?;
        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .invoke(light_cpi_accounts)?;

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        ctx.accounts.validate(
            ctx.remaining_accounts,
            &secp256r1_verify_args,
            settings_mut_args,
            &compressed_proof_args,
        )?;
        Ok(())
    }
}

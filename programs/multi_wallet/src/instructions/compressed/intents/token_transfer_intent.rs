use crate::{
    durable_nonce_check,
    state::{Settings, SettingsMutArgs},
    utils::{CompressedTokenArgs, SourceType, SplInterfacePdaArgs, TokenTransfer},
    ChallengeArgs, CompressedSettings, CompressedSettingsData, DomainConfig, MemberKey,
    MultisigError, Permission, ProofArgs, Secp256r1VerifyArgsWithDomainAddress,
    TransactionActionType, ID, LIGHT_CPI_SIGNER, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use anchor_spl::associated_token::{self};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
    LightAccount,
};
use light_token::{
    constants::LIGHT_TOKEN_PROGRAM_ID,
    instruction::{LIGHT_TOKEN_CPI_AUTHORITY},
};
use light_token_interface::find_spl_interface_pda_with_index;

#[derive(Accounts)]
#[instruction(spl_interface_pda_args: Option<SplInterfacePdaArgs>)]
pub struct TokenTransferIntentCompressed<'info> {
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
    /// CHECK: checked in instructions
    pub source: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,  
        seeds = [
            source.key().as_ref(),
            token_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = associated_token::ID
    )]
    pub source_spl_token_account: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,
        seeds = [
            source.key().as_ref(),
            LIGHT_TOKEN_PROGRAM_ID.as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = LIGHT_TOKEN_PROGRAM_ID
    )]
    pub source_ctoken_token_account: UncheckedAccount<'info>,
    /// CHECK:
    pub destination: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,  
        seeds = [
            destination.key().as_ref(),
            token_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = associated_token::ID
    )]
    pub destination_spl_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        mut,
        seeds = [
            destination.key().as_ref(),
            LIGHT_TOKEN_PROGRAM_ID.as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = LIGHT_TOKEN_PROGRAM_ID
    )]
    pub destination_ctoken_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK:
    pub token_program: UncheckedAccount<'info>,
    /// CHECK:
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = LIGHT_TOKEN_CPI_AUTHORITY
    )]
    pub compressed_token_program_authority: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,
        address = {
            if let Some(args) = &spl_interface_pda_args {
                find_spl_interface_pda_with_index(mint.key, args.index, args.restricted).0
            }else{
                ID
            }
        }
    )]
    pub spl_interface_pda: Option<UncheckedAccount<'info>>,
    /// CHECK:
    pub compressible_config: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub rent_sponsor: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = LIGHT_TOKEN_PROGRAM_ID,
    )]
    pub compressed_token_program: UncheckedAccount<'info>,
}

impl<'info> TokenTransferIntentCompressed<'info> {
    fn validate(
        &self,
        amount: u64,
        remaining_accounts: &'info [AccountInfo<'info>],
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings: &CompressedSettingsData,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            mint,
            destination,
            token_program,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;
        let mut are_delegates = true;

        let threshold = settings.threshold as usize;
        let secp256r1_member_keys: Vec<(MemberKey, &Secp256r1VerifyArgsWithDomainAddress)> =
            secp256r1_verify_args
                .iter()
                .filter_map(|arg| {
                    let pubkey = arg
                        .verify_args
                        .extract_public_key_from_instruction(Some(&self.instructions_sysvar))
                        .ok()?;

                    let member_key = MemberKey::convert_secp256r1(&pubkey).ok()?;

                    Some((member_key, arg))
                })
                .collect();

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);

            let secp256r1_signer = secp256r1_member_keys
                .iter()
                .find(|f| f.0.eq(&member.pubkey));

            let is_signer = secp256r1_signer.is_some()
                || remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .map_or(false, |key| key.eq(&member.pubkey))
                });

            if is_signer {
                if has_permission(Permission::InitiateTransaction) {
                    initiate = true;
                }
                if has_permission(Permission::ExecuteTransaction) {
                    execute = true;
                }
                if has_permission(Permission::VoteTransaction) {
                    vote_count += 1;
                }
                if secp256r1_signer.is_some() && member.is_delegate == 0 {
                    are_delegates = false;
                }
            }

            if let Some((_, secp256r1_verify_data)) = secp256r1_signer {
                let account_loader = DomainConfig::extract_domain_config_account(
                    remaining_accounts,
                    secp256r1_verify_data.domain_config_key,
                )?;

                let mut buffer = vec![];
                buffer.extend_from_slice(amount.to_le_bytes().as_ref());
                buffer.extend_from_slice(destination.key().as_ref());
                buffer.extend_from_slice(mint.key().as_ref());
                let message_hash =
                    Sha256::hash(&buffer).map_err(|_| MultisigError::HashComputationFailed)?;

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: token_program.key(),
                        message_hash,
                        action_type: TransactionActionType::TransferIntent,
                    },
                    &[],
                )?;
            }
        }

        require!(
            initiate,
            MultisigError::InsufficientSignerWithInitiatePermission
        );
        require!(
            execute,
            MultisigError::InsufficientSignerWithExecutePermission
        );
        require!(
            vote_count >= threshold,
            MultisigError::InsufficientSignersWithVotePermission
        );
        require!(are_delegates, MultisigError::InvalidNonDelegatedSigners);

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        spl_interface_pda_args: Option<SplInterfacePdaArgs>,
        amount: u64,
        source_compressed_token_accounts: Option<Vec<CompressedTokenArgs>>,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
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

        let settings_key =
            Settings::get_settings_key_from_index(settings_data.index, settings_data.bump)?;

        ctx.accounts.validate(
            amount,
            ctx.remaining_accounts,
            &secp256r1_verify_args,
            &settings_data,
        )?;

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

        let token_transfer = TokenTransfer {
            source: &ctx.accounts.source,
            destination: &ctx.accounts.destination,
            mint: &ctx.accounts.mint,
            payer: &ctx.accounts.payer,
            source_spl_token_account: &ctx.accounts.source_spl_token_account,
            source_ctoken_token_account: &ctx.accounts.source_ctoken_token_account,
            destination_spl_token_account: ctx.accounts.destination_spl_token_account.as_deref(),
            destination_ctoken_token_account: ctx
                .accounts
                .destination_ctoken_token_account
                .as_deref(),
            spl_interface_pda: ctx.accounts.spl_interface_pda.as_deref(),
            token_program: &ctx.accounts.token_program,
            compressed_token_program_authority: &ctx.accounts.compressed_token_program_authority,
            compressible_config: &ctx.accounts.compressible_config,
            rent_sponsor: ctx.accounts.rent_sponsor.as_deref(),
            system_program: &ctx.accounts.system_program,
            destination_ctoken_bump: ctx.bumps.destination_ctoken_token_account,
            spl_interface_pda_args,
        };

        let spl_interface_pda_data =
            token_transfer.create_spl_interface_pda_if_needed(ctx.remaining_accounts)?;

        let source_type = token_transfer.load_ata(
            amount,
            &source_compressed_token_accounts,
            Some(&light_cpi_accounts),
            Some(&compressed_proof_args),
            &spl_interface_pda_data,
            signer_seeds,
        )?;

        let has_dst_spl = ctx.accounts.destination_spl_token_account.is_some();
        let has_dst_ctoken = ctx.accounts.destination_ctoken_token_account.is_some();
        match (source_type, has_dst_spl, has_dst_ctoken) {
            (SourceType::Spl, true, false) => {
                token_transfer.spl_to_spl_transfer(amount, signer_seeds)?;
            }
            (SourceType::Spl, false, true) => {
                token_transfer.spl_to_ctoken_transfer(
                    amount,
                    &spl_interface_pda_data,
                    signer_seeds,
                )?;
            }

            (SourceType::CToken, true, false) => {
                let destination_token_account = ctx
                    .accounts
                    .destination_spl_token_account
                    .as_ref()
                    .ok_or(MultisigError::MissingDestinationTokenAccount)?;
                token_transfer.ctoken_to_spl_transfer(
                    amount,
                    &spl_interface_pda_data,
                    signer_seeds,
                    destination_token_account,
                )?;
            }
            (SourceType::CToken, false, true) => {
                token_transfer.ctoken_to_ctoken_transfer(amount, signer_seeds)?;
            }

            (SourceType::CompressedToken, false, true) => {
                let destination_token_account = ctx
                    .accounts
                    .destination_ctoken_token_account
                    .as_ref()
                    .ok_or(MultisigError::MissingDestinationTokenAccount)?;
                token_transfer.create_destination_ctoken_ata()?;
                token_transfer.compressed_token_to_ctoken_transfer(
                    &source_compressed_token_accounts,
                    Some(&light_cpi_accounts),
                    Some(&compressed_proof_args),
                    signer_seeds,
                    amount,
                    destination_token_account,
                )?;
            }

            (SourceType::CompressedToken, true, false) => {
                let destination_token_account = ctx
                    .accounts
                    .destination_spl_token_account
                    .as_ref()
                    .ok_or(MultisigError::MissingDestinationTokenAccount)?;
                token_transfer.compressed_token_to_spl_transfer(
                    &source_compressed_token_accounts,
                    Some(&light_cpi_accounts),
                    Some(&compressed_proof_args),
                    signer_seeds,
                    &spl_interface_pda_data,
                    amount,
                    destination_token_account,
                )?;
            }

            _ => return err!(MultisigError::InvalidTokenSourceType),
        }

        let mut slot_numbers = Vec::with_capacity(secp256r1_verify_args.len());
        slot_numbers.extend(
            secp256r1_verify_args
                .iter()
                .map(|f| f.verify_args.slot_number),
        );
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

use crate::{
    state::ProofArgs,
    utils::{CompressedTokenArgs, SourceType, SplInterfacePdaArgs, TokenTransfer, TransactionSyncSigners},
    MultisigError, Settings, TransactionActionType, ID, LIGHT_CPI_SIGNER, SEED_MULTISIG,
    SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use anchor_spl::associated_token::{self};
use light_sdk::{
    cpi::v2::CpiAccounts,
    light_hasher::{Hasher, Sha256},
};
use light_token::{constants::LIGHT_TOKEN_PROGRAM_ID, instruction::LIGHT_TOKEN_CPI_AUTHORITY};
use light_token_interface::find_spl_interface_pda_with_index;

#[derive(Accounts)]
#[instruction(spl_interface_pda_args: Option<SplInterfacePdaArgs>)]
pub struct TokenTransferIntent<'info> {
    #[account(mut)]
    pub settings: Account<'info, Settings>,
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
    /// CHECK:
    #[account(
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_VAULT,
        ],
        bump = settings.multi_wallet_bump,
    )]
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

impl<'info> TokenTransferIntent<'info> {
    fn validate(
        &self,
        amount: u64,
        remaining_accounts: &'info [AccountInfo<'info>],
        signers: &Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            mint,
            destination,
            settings,
            token_program,
            ..
        } = &self;

        let mut buffer = vec![];
        buffer.extend_from_slice(amount.to_le_bytes().as_ref());
        buffer.extend_from_slice(destination.key().as_ref());
        buffer.extend_from_slice(mint.key().as_ref());
        let message_hash =
            Sha256::hash(&buffer).map_err(|_| MultisigError::HashComputationFailed)?;

        TransactionSyncSigners::verify(
            signers,
            remaining_accounts,
            instructions_sysvar,
            slot_hash_sysvar,
            &settings.members,
            settings.threshold,
            token_program.key(),
            message_hash,
            TransactionActionType::TransferIntent,
        )?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(amount, &ctx.remaining_accounts, &signers))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        spl_interface_pda_args: Option<SplInterfacePdaArgs>,
        amount: u64,
        source_compressed_token_accounts: Option<Vec<CompressedTokenArgs>>,
        compressed_proof_args: Option<ProofArgs>,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let settings_key = &ctx.accounts.settings.key();
        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[ctx.accounts.settings.multi_wallet_bump],
        ];

        let mut light_cpi_accounts = None;

        if let Some(compressed_proof_args) = &compressed_proof_args {
            let account_infos = CpiAccounts::new(
                &ctx.accounts.payer,
                &ctx.remaining_accounts
                    [compressed_proof_args.light_cpi_accounts_start_index as usize..],
                LIGHT_CPI_SIGNER,
            );
            light_cpi_accounts = Some(account_infos)
        }

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
            light_cpi_accounts.as_ref(),
            compressed_proof_args.as_ref(),
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
                    light_cpi_accounts.as_ref(),
                    compressed_proof_args.as_ref(),
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
                    light_cpi_accounts.as_ref(),
                    compressed_proof_args.as_ref(),
                    signer_seeds,
                    &spl_interface_pda_data,
                    amount,
                    destination_token_account,
                )?;
            }

            _ => return err!(MultisigError::InvalidTokenSourceType),
        }

        let settings = &mut ctx.accounts.settings;
        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        Ok(())
    }
}

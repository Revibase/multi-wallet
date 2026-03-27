use crate::{
    utils::TransactionSyncSigners, MultisigError, Settings, TransactionActionType, SEED_MULTISIG,
    SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, sysvar::SysvarId},
};
use anchor_spl::{
    associated_token::{
        self, AssociatedToken, spl_associated_token_account::instruction::create_associated_token_account_idempotent
    },
    token_interface::{Mint, TokenInterface, TransferChecked, transfer_checked},
};
use light_sdk::light_hasher::{Hasher, Sha256};

#[derive(Accounts)]
pub struct TokenTransferIntent<'info> {
    #[account(mut)]
    pub settings: Account<'info, Settings>,
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
        mut,
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
    pub destination_spl_token_account: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> TokenTransferIntent<'info> {
    fn validate(
        &self,
        amount: u64,
        remaining_accounts: &'info [AccountInfo<'info>],
        signers: &[TransactionSyncSigners],
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

        let mut buffer = Vec::with_capacity(72);
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
        amount: u64,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let settings_key = &ctx.accounts.settings.key();
        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[ctx.accounts.settings.multi_wallet_bump],
        ];

        let ix = create_associated_token_account_idempotent(
            ctx.accounts.source.key,
            ctx.accounts.destination.key,
            &ctx.accounts.mint.key(),
            &ctx.accounts.token_program.key(),
        );

        invoke_signed(
            &ix,
            &[
                ctx.accounts.source.to_account_info(),
                ctx.accounts.destination_spl_token_account.to_account_info(),
                ctx.accounts.destination.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source_spl_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination_spl_token_account.to_account_info(),
                    authority: ctx.accounts.source.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let settings = &mut ctx.accounts.settings;
        let slot_numbers = TransactionSyncSigners::collect_slot_numbers(&signers);
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        Ok(())
    }
}

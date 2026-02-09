use crate::{
    utils::{MultisigSettings, TransactionSyncSigners},
    MultisigError, Settings, TransactionActionType, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::SysvarId,
    system_program::{transfer, Transfer},
};
use light_sdk::light_hasher::{Hasher, Sha256};

#[derive(Accounts)]
pub struct NativeTransferIntent<'info> {
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
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> NativeTransferIntent<'info> {
    fn validate(
        &self,
        amount: u64,
        remaining_accounts: &'info [AccountInfo<'info>],
        signers: &Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            system_program,
            destination,
            settings,
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
            settings.get_members()?,
            settings.get_threshold()?,
            system_program.key(),
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
        let settings = &mut ctx.accounts.settings;
        let settings_key = settings.key();
        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

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
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        Ok(())
    }
}

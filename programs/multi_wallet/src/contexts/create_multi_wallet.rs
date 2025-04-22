use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use crate::{id, state::{ConfigEvent, MemberWithVerifyArgs, Settings, SEED_MULTISIG, SEED_VAULT}};

#[derive(Accounts)]
#[instruction(create_key: Pubkey, initial_members: Vec<MemberWithVerifyArgs>)]
pub struct CreateMultiWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(initial_members.len()), 
        seeds = [SEED_MULTISIG, create_key.as_ref()],
        bump,
    )]
    pub settings: Account<'info, Settings>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
}

impl<'info> CreateMultiWallet<'info> {
    pub fn process(ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>, create_key: Pubkey, initial_members: Vec<MemberWithVerifyArgs>, metadata: Option<Pubkey>) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let settings_key = settings.to_account_info().key();
        let (multi_wallet_key, multi_wallet_bump) = Pubkey::find_program_address(
            &[
                SEED_MULTISIG,
                settings_key.as_ref(),
                SEED_VAULT,
            ],
            &id(),
        );
        settings.create_key = create_key;
        settings.bump = ctx.bumps.settings;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.metadata = metadata;
        settings.threshold = 1;
        settings.members = vec![];  
        settings.add_members(&settings_key, &multi_wallet_key, initial_members, ctx.remaining_accounts, &ctx.accounts.payer, &ctx.accounts.system_program, &ctx.accounts.slot_hash_sysvar)?;
        settings.invariant()?;
        
        emit!(ConfigEvent {
            create_key: settings.create_key,
            members: settings.members.clone(),
            threshold: settings.threshold,
            metadata: settings.metadata,
        });
        Ok(())
    }
}
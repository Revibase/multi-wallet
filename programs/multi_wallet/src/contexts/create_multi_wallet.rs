use anchor_lang::prelude::*;
use crate::{error::MultisigError, state::{ConfigEvent, Delegate, Settings, SEED_DELEGATE, SEED_MULTISIG, SEED_VAULT}, Member};

#[event_cpi]
#[derive(Accounts)]
#[instruction(initial_member: Member, create_key: Pubkey)]
pub struct CreateMultiWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(1), 
        seeds = [SEED_MULTISIG, create_key.as_ref()],
        bump,
    )]
    pub settings: Account<'info, Settings>,
    #[account(
        init,
        payer = payer,
        space = Delegate::size(),
        seeds = [SEED_DELEGATE, initial_member.pubkey.get_seed()],
        bump,
    )]
    pub delegate: Option<AccountLoader<'info, Delegate>>,
    #[account(
        mut,
        seeds = [SEED_MULTISIG, settings.key().as_ref(), SEED_VAULT],
        bump,
    )]
    pub multi_wallet: SystemAccount<'info,>,
    pub system_program: Program<'info, System>
}

impl<'info> CreateMultiWallet<'info> {
    pub fn process(ctx: Context<'_, '_, '_, 'info, Self>, initial_member: Member, create_key: Pubkey, metadata: Option<Pubkey>) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        if initial_member.permissions.has(crate::state::Permission::IsDelegate) {
            require!(ctx.accounts.delegate.is_some(), MultisigError::MissingAccount);
            let delegate = &mut ctx.accounts.delegate.as_ref().unwrap().load_init().unwrap();
            delegate.bump = ctx.bumps.delegate.unwrap();
            delegate.multi_wallet_settings = settings.key();
            delegate.multi_wallet =  ctx.accounts.multi_wallet.key();
        }
        settings.create_key = create_key;
        settings.bump = ctx.bumps.settings;
        settings.multi_wallet_bump = ctx.bumps.multi_wallet;
        settings.metadata = metadata;
        settings.threshold = 1;
        settings.members = vec![initial_member.clone()];
        settings.invariant()?;

        emit_cpi!(ConfigEvent {
            create_key: settings.create_key,
            members: settings.members.clone(),
            threshold: settings.threshold,
            metadata: settings.metadata,
        });
        Ok(())
    }
}
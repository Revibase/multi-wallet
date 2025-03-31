use anchor_lang::prelude::*;
use crate::{state::{Settings, SEED_MULTISIG, SEED_VAULT}, utils::realloc_if_needed, ConfigAction, ConfigEvent};

#[event_cpi]
#[derive(Accounts)]
pub struct ChangeConfig<'info> {
    #[account(
        mut, 
        seeds = [SEED_MULTISIG, settings.create_key.as_ref()],
        bump = settings.bump
    )]
    pub settings: Account<'info, Settings>,
    #[account(
        mut,
        seeds = [SEED_MULTISIG, settings.key().as_ref(), SEED_VAULT],
        bump = settings.multi_wallet_bump,
    )]
    pub multi_wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> ChangeConfig<'info> {
    pub fn process(ctx: Context<'_, '_, '_, 'info, Self>, config_actions: Vec<ConfigAction>,) -> Result<()> {   
        let settings = &mut ctx.accounts.settings;
        let system_program = &ctx.accounts.system_program;
        let payer = &ctx.accounts.multi_wallet;
        let current_size = settings.to_account_info().data.borrow().len();
        let remaining_accounts = ctx.remaining_accounts;
        for action in config_actions {
            match action {
                ConfigAction::AddMembers(members) => {
                    settings.add_members(members,remaining_accounts,payer,system_program)?;
                }
                ConfigAction::RemoveMembers(members) => {
                    settings.remove_members(members,remaining_accounts, payer)?;
                }
                ConfigAction::SetMembers(members) => {
                    settings.set_members(members, remaining_accounts, payer, system_program)?;
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.threshold = new_threshold;
                }
                ConfigAction::SetMetadata(metadata) => {
                    settings.metadata = metadata;
                }
            }
        }

        realloc_if_needed(
            &settings.to_account_info(),
            current_size,
            Settings::size(settings.members.len()),
            &ctx.accounts
            .multi_wallet.to_account_info(),
        &ctx.accounts
            .system_program.to_account_info(),
        )?;

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
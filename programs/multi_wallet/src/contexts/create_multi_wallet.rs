use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use crate::{id, state::{ConfigEvent, Member, MemberKey, MemberWithVerifyArgs, Permission, Permissions, Secp256r1VerifyArgs, Settings, SEED_MULTISIG, SEED_VAULT}, utils::create_delegate_account};

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Option<Secp256r1VerifyArgs>)]
pub struct CreateMultiWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(1), 
        seeds = [
            SEED_MULTISIG,  
            {&MemberKey::get_signer(&initial_member, &secp256r1_verify_args)?.get_seed()}
        ],
        bump
    )]
    pub settings: Account<'info, Settings>,
    pub initial_member: Option<Signer<'info>>,
    pub system_program: Program<'info, System>,
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

impl<'info> CreateMultiWallet<'info> {
    pub fn process(ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>,
    secp256r1_verify_args: Option<Secp256r1VerifyArgs>, domain_config: Option<Pubkey>) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let initial_member = &ctx.accounts.initial_member;
        let settings_key = settings.to_account_info().key();
        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[
                SEED_MULTISIG,
                settings_key.as_ref(),
                SEED_VAULT,
            ],
            &id(),
        );

        let signer: MemberKey = MemberKey::get_signer(&initial_member, &secp256r1_verify_args)?;
        let permissions = Permissions::from_vec(
            &[
            Permission::InitiateTransaction, 
            Permission::VoteTransaction, 
            Permission::ExecuteTransaction, 
            Permission::IsDelegate, 
            Permission::IsInitialMember
            ]
        );
        let member = MemberWithVerifyArgs{ 
            data: Member { 
                pubkey: signer, 
                permissions, 
                domain_config  
            }, 
            verify_args: secp256r1_verify_args 
        };
        settings.bump = ctx.bumps.settings;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.threshold = 1;
        settings.members = vec![];  
        let members_to_create_delegate_account = settings.add_members(&settings_key, vec![member], ctx.remaining_accounts,  &ctx.accounts.slot_hash_sysvar, &ctx.accounts.instructions_sysvar)?;
        for member in members_to_create_delegate_account {
            create_delegate_account(&ctx.remaining_accounts,&ctx.accounts.payer, &ctx.accounts.system_program, &settings_key, &member)?;
        }
        
        settings.invariant(&signer)?;
        
        emit!(ConfigEvent {
            members: settings.members.clone(),
            threshold: settings.threshold,
        });
        Ok(())
    }
}
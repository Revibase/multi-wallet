use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{CpiAccounts, CpiInputs};
use crate::{id, state::{DomainConfig, GlobalCounter, Member, MemberKey, MemberWithAddPermissionsArgs, Ops, Permissions, ProofArgs, Secp256r1VerifyArgs, Settings, User, UserMutArgs, SEED_MULTISIG, SEED_VAULT}, LIGHT_CPI_SIGNER};

#[derive(Accounts)]
pub struct CreateMultiWallet<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(), 
        seeds = [
            SEED_MULTISIG,  
            global_counter.load()?.index.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub settings: AccountLoader<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(
        mut
    )]
    pub global_counter: AccountLoader<'info, GlobalCounter>
}

impl<'info> CreateMultiWallet<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        permissions: Permissions,
        compressed_proof_args: ProofArgs,
        user_mut_args: UserMutArgs,
        set_as_delegate: bool,
    ) -> Result<()> {
        let signer: MemberKey = MemberKey::get_signer(&ctx.accounts.initial_member, &secp256r1_verify_args, ctx.accounts.instructions_sysvar.as_ref())?;

        let settings = &mut ctx.accounts.settings.load_init()?;
        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[
                SEED_MULTISIG,
                ctx.accounts.settings.key().as_ref(),
                SEED_VAULT,
            ],
            &id(),
        );
        let global_counter =&mut  ctx.accounts.global_counter.load_mut()?;
        settings.bump = ctx.bumps.settings;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.set_threshold(1)?;
        settings.set_members(vec![])?;
        settings.members_len = 1;
        settings.index = global_counter.index;

        let delegate_ops = settings.add_members(&ctx.accounts.settings.key(), 
        vec![MemberWithAddPermissionsArgs {
                member: Member {
                    pubkey: signer,
                    permissions,
                },
                verify_args: secp256r1_verify_args,
                user_args: user_mut_args,
                set_as_delegate,
            }], 
            ctx.remaining_accounts, 
            &ctx.accounts.slot_hash_sysvar, 
            ctx.accounts.instructions_sysvar.as_ref()
        )?;

        settings.invariant()?;

        let light_cpi_accounts =
            CpiAccounts::new(&ctx.accounts.payer, &ctx.remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..], LIGHT_CPI_SIGNER);
    
        let account_infos = User::handle_user_delegate_accounts(
            delegate_ops.into_iter().map(Ops::Create).collect(),
            settings.index,
        )?;
        
        let cpi_inputs = CpiInputs::new(
            compressed_proof_args.proof,
            account_infos,
        );
        cpi_inputs
            .invoke_light_system_program(light_cpi_accounts)
            .map_err(ProgramError::from)?;
            
     
        global_counter.index +=1;
        Ok(())
    }
}
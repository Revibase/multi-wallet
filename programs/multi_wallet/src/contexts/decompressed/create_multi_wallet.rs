use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
};
use crate::{id, state::UserReadOnlyOrMutateArgs, DomainConfig, GlobalCounter, Member, MemberKey, AddMemberArgs, MultisigError, Ops, Permission, Permissions, ProofArgs, Secp256r1VerifyArgs, Settings, User, UserMutArgs, LIGHT_CPI_SIGNER, SEED_MULTISIG, SEED_VAULT};

#[derive(Accounts)]
#[instruction(settings_index: u128)]
pub struct CreateMultiWallet<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(), 
        seeds = [
            SEED_MULTISIG,  
            settings_index.to_le_bytes().as_ref(),
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
    #[account(mut)]
    pub global_counter: AccountLoader<'info, GlobalCounter>
}

impl<'info> CreateMultiWallet<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>,
        settings_index:u128,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
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
        require!(global_counter.index.eq(&settings_index), MultisigError::InvalidArguments);

        settings.bump = ctx.bumps.settings;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.set_threshold(1)?;
        settings.set_members(vec![])?;
        settings.members_len = 1;
        settings.index = global_counter.index;

        let mut permissions = Vec::new();
        permissions.extend([
            Permission::InitiateTransaction,
            Permission::VoteTransaction,
            Permission::ExecuteTransaction,
        ]);
        if user_mut_args.data.is_permanent_member {
            permissions.push(Permission::IsPermanentMember);
        }

        let delegate_ops = settings.add_members(&ctx.accounts.settings.key(), 
        vec![AddMemberArgs {
                member: Member {
                    pubkey: signer,
                    permissions: Permissions::from_permissions(permissions),
                },
                verify_args: secp256r1_verify_args,
                user_args: UserReadOnlyOrMutateArgs::Mutate(user_mut_args),
                set_as_delegate,
            }], 
            ctx.remaining_accounts, 
            &ctx.accounts.slot_hash_sysvar, 
            ctx.accounts.instructions_sysvar.as_ref()
        )?;

        settings.invariant()?;

        let light_cpi_accounts =
            CpiAccounts::new(&ctx.accounts.payer, &ctx.remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..], LIGHT_CPI_SIGNER);
    
        let user_account_info = User::handle_user_delegates(
            delegate_ops.into_iter().map(Ops::Add).collect(),
            settings.index,
            &light_cpi_accounts
        )?;

        let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof);

        for account_info in user_account_info {
            cpi = cpi.with_light_account(account_info)?;
        }

        cpi.invoke(light_cpi_accounts)?;
        
        global_counter.index +=1;
        Ok(())
    }
}
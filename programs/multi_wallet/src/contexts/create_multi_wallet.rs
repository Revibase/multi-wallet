use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use crate::{error::MultisigError, id, state::{Delegate, DomainConfig, KeyType, Member, MemberKey, Permission, Permissions, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings, TransactionActionType, SEED_DELEGATE, SEED_MULTISIG, SEED_VAULT}};

#[derive(Accounts)]
#[instruction(create_key: Pubkey, secp256r1_verify_args: Option<Secp256r1VerifyArgs>)]
pub struct CreateMultiWallet<'info> {
    #[account(
        init, 
        payer = payer, 
        space = Settings::size(1), 
        seeds = [
            SEED_MULTISIG,  
            create_key.as_ref(),
        ],
        bump
    )]
    pub settings: Account<'info, Settings>,
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
        init,
        payer = payer,
        space = Delegate::size(), 
        seeds = [
            SEED_DELEGATE,  
            {&MemberKey::get_signer(&initial_member, &secp256r1_verify_args)?.get_seed()}
        ],
        bump
    )]
    pub delegate_account: Option<AccountLoader<'info, Delegate>>,
}

impl<'info> CreateMultiWallet<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>,
        create_key: Pubkey,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        permissions: Permissions
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let initial_member = &ctx.accounts.initial_member;
        let settings_key = settings.to_account_info().key();

        if permissions.has(Permission::IsDelegate) {
            require!(ctx.accounts.delegate_account.is_some(), MultisigError::InsuffientSignerWithDelegatePermission);
            let delegate_account = &mut ctx.accounts.delegate_account.as_ref().unwrap().load_init()?;
            delegate_account.bump = ctx.bumps.delegate_account.unwrap();
            delegate_account.multi_wallet_settings = settings_key;
        }

        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[
                SEED_MULTISIG,
                settings_key.as_ref(),
                SEED_VAULT,
            ],
            &id(),
        );
        let signer: MemberKey = MemberKey::get_signer(&initial_member, &secp256r1_verify_args)?;

        let domain_config = ctx.accounts.domain_config.as_ref().map(|f| f.key());
        
        let member = Member { 
            pubkey: signer, 
            permissions, 
            domain_config,
        };

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let secp256r1_verify_data = secp256r1_verify_args
            .as_ref()
            .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            let rp_id_hash = ctx.accounts.domain_config.as_ref().ok_or(MultisigError::DomainConfigIsMissing)?.load()?.rp_id_hash;

            Secp256r1Pubkey::verify_webauthn(
                secp256r1_verify_data,
                &ctx.accounts.slot_hash_sysvar,
                &ctx.accounts.domain_config,
                &settings_key,
                &rp_id_hash,
                TransactionActionType::AddNewMember,
                &ctx.accounts.instructions_sysvar,
            )?;
        }

        settings.bump = ctx.bumps.settings;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.threshold = 1;
        settings.members = [member].to_vec();
        settings.create_key = create_key;
        settings.invariant()?;

        Ok(())
    }
}
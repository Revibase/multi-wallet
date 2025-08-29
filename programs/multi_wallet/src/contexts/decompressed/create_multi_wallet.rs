use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{CpiAccounts, CpiInputs};
use crate::{error::MultisigError, id, state::{ChallengeArgs, DomainConfig, GlobalCounter, KeyType, Member, MemberKey, Permissions, ProofArgs, Secp256r1VerifyArgs, Settings, TransactionActionType, User, UserMutArgs, SEED_MULTISIG, SEED_VAULT}, LIGHT_CPI_SIGNER};

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
    ) -> Result<()> {

        let signer: MemberKey = MemberKey::get_signer(&ctx.accounts.initial_member, &secp256r1_verify_args, ctx.accounts.instructions_sysvar.as_ref())?;

        let domain_config_key = ctx.accounts.domain_config.as_ref().map(|f| f.key());

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let secp256r1_verify_data = secp256r1_verify_args
            .as_ref()
            .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            let rp_id_hash = ctx.accounts.domain_config.as_ref().ok_or(MultisigError::DomainConfigIsMissing)?.load()?.rp_id_hash;

            let instructions_sysvar = ctx.accounts.instructions_sysvar
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;

            let domain_config_key = domain_config_key.ok_or(MultisigError::DomainConfigIsMissing)?;
            secp256r1_verify_data.verify_webauthn(
                &ctx.accounts.slot_hash_sysvar,
                &ctx.accounts.domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: domain_config_key,
                    message_hash: rp_id_hash,
                    action_type: TransactionActionType::CreateNewWallet,
                },
            )?;
        }

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
        settings.set_members(vec![Member { 
            pubkey: signer, 
            permissions, 
            domain_config: match  domain_config_key {
                Some(value) => value,
                None => Pubkey::default()
            },
        }])?;
        settings.members_len = 1;
        settings.index = global_counter.index;
        settings.invariant()?;

        let light_cpi_accounts =
            CpiAccounts::new(&ctx.accounts.payer, &ctx.remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..], LIGHT_CPI_SIGNER);
    
        let account_infos = vec![User::handle_set_user_delegate(
            user_mut_args,
            global_counter.index,
            true,
            true,
        )?];
        
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
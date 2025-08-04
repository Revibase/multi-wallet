use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{CpiAccounts, CpiInputs};
use crate::{error::MultisigError, id, state::{ChallengeArgs, Delegate, DelegateCreateOrMutateArgs, DomainConfig, GlobalCounter, KeyType, Member, MemberKey, Permission, Permissions, ProofArgs, Secp256r1VerifyArgs, Settings, TransactionActionType, SEED_MULTISIG, SEED_VAULT}, LIGHT_CPI_SIGNER};

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
        compressed_proof_args: Option<ProofArgs>,
        delegate_creation_args: Option<DelegateCreateOrMutateArgs>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings.load_init()?;
        let initial_member = &ctx.accounts.initial_member;
        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[
                SEED_MULTISIG,
                ctx.accounts.settings.key().as_ref(),
                SEED_VAULT,
            ],
            &id(),
        );
        let signer: MemberKey = MemberKey::get_signer(&initial_member, &secp256r1_verify_args, ctx.accounts.instructions_sysvar.as_ref())?;

        let domain_config = ctx.accounts.domain_config.as_ref().map(|f| f.key());

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let secp256r1_verify_data = secp256r1_verify_args
            .as_ref()
            .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            let rp_id_hash = ctx.accounts.domain_config.as_ref().ok_or(MultisigError::DomainConfigIsMissing)?.load()?.rp_id_hash;

            let instructions_sysvar = ctx.accounts.instructions_sysvar
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;

            secp256r1_verify_data.verify_webauthn(
                &ctx.accounts.slot_hash_sysvar,
                &ctx.accounts.domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: ctx.accounts.settings.key(),
                    message_hash: rp_id_hash,
                    action_type: TransactionActionType::AddNewMember,
                },
            )?;
        }

        let global_counter =&mut  ctx.accounts.global_counter.load_mut()?;
        settings.bump = ctx.bumps.settings;
        settings.multi_wallet_bump = multi_wallet_bump;
        settings.set_threshold(1)?;
        settings.set_members(vec![Member { 
            pubkey: signer, 
            permissions, 
            domain_config: match  domain_config {
                Some(value) => value,
                None => Pubkey::default()
            },
        }])?;
        settings.members_len = 1;
        settings.index = global_counter.index;
        settings.invariant()?;

        if permissions.has(Permission::IsDelegate) {
            let proof_args = compressed_proof_args.ok_or(MultisigError::MissingDelegateArgs)?;
            let light_cpi_accounts =
                CpiAccounts::new(&ctx.accounts.payer, &ctx.remaining_accounts[proof_args.light_cpi_accounts_start_index as usize..], LIGHT_CPI_SIGNER);
            let (account_infos, new_addresses) = Delegate::handle_create_or_recreate_delegate(
                delegate_creation_args,
                global_counter.index,
                signer,
                &light_cpi_accounts,
            )?;
            if account_infos.len() > 0 || new_addresses.len() > 0 {
                let cpi_inputs = CpiInputs::new_with_address(
                    proof_args.proof,
                    account_infos,
                    new_addresses,
                );
                cpi_inputs
                    .invoke_light_system_program(light_cpi_accounts)
                    .map_err(ProgramError::from)?;
            }
        }
        global_counter.index +=1;
        Ok(())
    }
}
use crate::{
    error::MultisigError,
    state::{DomainConfig, ProofArgs, User, UserCreationArgs, WhitelistedAddressTree},
    utils::{MemberKey, UserRole, SEED_DOMAIN_CONFIG, SEED_WHITELISTED_ADDRESS_TREE},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
    PackedAddressTreeInfoExt,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateDomainConfigArgs {
    rp_id: String,
    origins: Vec<String>,
    authority_creation_args: UserCreationArgs,
    compressed_proof_args: ProofArgs,
}

#[derive(Accounts)]
#[instruction(args: CreateDomainConfigArgs)]
pub struct CreateDomainConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = DomainConfig::size(),
        seeds = [SEED_DOMAIN_CONFIG, {
            Sha256::hash(args.rp_id.as_bytes())
                .expect("Failed to hash rp_id for domain config seeds")
                .as_ref()
        }],
        bump,
    )]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        seeds = [SEED_WHITELISTED_ADDRESS_TREE],
        bump = whitelisted_address_trees.bump
    )]
    pub whitelisted_address_trees: Account<'info, WhitelistedAddressTree>,
}

impl<'info> CreateDomainConfig<'info> {
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        args: CreateDomainConfigArgs,
    ) -> Result<()> {
        #[cfg(feature = "mainnet")]
        require!(
            ctx.accounts.payer.key().eq(&crate::ADMIN),
            crate::MultisigError::UnauthorizedAdminOnly
        );

        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [args.compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let address_tree = PackedAddressTreeInfoExt::get_tree_pubkey(
            &args.authority_creation_args.address_tree_info,
            &light_cpi_accounts,
        )
        .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let user_address_tree_index = ctx
            .accounts
            .whitelisted_address_trees
            .extract_address_tree_index(&address_tree)?;

        let user = User {
            member: MemberKey::convert_ed25519(&ctx.accounts.authority.key())?,
            role: UserRole::Administrator,
            wallets: vec![],
            transports: None,
            credential_id: None,
            domain_config: Some(ctx.accounts.domain_config.key()),
            transaction_manager_url: None,
            user_address_tree_index,
        };

        let (account_info, new_address_params) =
            User::create_user_account(args.authority_creation_args, &address_tree, user, Some(0))?;

        account_info.invariant()?;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(args.compressed_proof_args.proof),
        )
        .with_light_account(account_info)?
        .with_new_addresses(&[new_address_params])
        .invoke(light_cpi_accounts)?;

        let domain_config = &mut ctx.accounts.domain_config.load_init()?;
        domain_config.rp_id_hash = Sha256::hash(args.rp_id.as_bytes())
            .map_err(|_| MultisigError::HashComputationFailed)?;
        domain_config.write_rp_id(args.rp_id)?;
        domain_config.write_origins(args.origins)?;
        domain_config.authority = ctx.accounts.authority.key();
        domain_config.bump = ctx.bumps.domain_config;
        domain_config.is_disabled = 0;

        Ok(())
    }
}

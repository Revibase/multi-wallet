use crate::{
    error::MultisigError,
    state::{DomainConfig, ProofArgs, User, UserCreationArgs, WhitelistedAddressTree},
    utils::{MemberKey, UserRole, SEED_WHITELISTED_ADDRESS_TREE},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct EditDomainConfigArgs {
    new_origins: Option<Vec<String>>,
    new_authority_args: Option<NewAuthorityArgs>,
    new_metadata_url: Option<String>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NewAuthorityArgs {
    authority_creation_args: UserCreationArgs,
    compressed_proof_args: ProofArgs,
}

#[derive(Accounts)]
pub struct EditDomainConfig<'info> {
    #[account(mut)]
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        mut,
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    pub new_authority: Option<Signer<'info>>,
    #[account(
        seeds = [SEED_WHITELISTED_ADDRESS_TREE],
        bump = whitelisted_address_trees.bump
    )]
    pub whitelisted_address_trees: Option<Account<'info, WhitelistedAddressTree>>,
    pub system_program: Program<'info, System>,
}

impl<'info> EditDomainConfig<'info> {
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        args: EditDomainConfigArgs,
    ) -> Result<()> {
        let domain_config = &mut ctx.accounts.domain_config.load_mut()?;

        if let Some(args) = args.new_authority_args {
            let new_authority = ctx
                .accounts
                .new_authority
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;

            let whitelisted_address_trees = ctx
                .accounts
                .whitelisted_address_trees
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;

            let light_cpi_accounts = CpiAccounts::new(
                &ctx.accounts.authority,
                &ctx.remaining_accounts
                    [args.compressed_proof_args.light_cpi_accounts_start_index as usize..],
                LIGHT_CPI_SIGNER,
            );

            let address_tree = &args
                .authority_creation_args
                .address_tree_info
                .get_tree_pubkey(&light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

            let user_address_tree_index =
                whitelisted_address_trees.extract_address_tree_index(address_tree)?;

            let user = User {
                member: MemberKey::convert_ed25519(&new_authority.key())?,
                role: UserRole::Administrator,
                delegated_to: None,
                domain_config: Some(ctx.accounts.domain_config.key()),
                transaction_manager_url: None,
                user_address_tree_index,
            };

            user.invariant()?;

            let (account_info, new_address_params) = User::create_user_account(
                args.authority_creation_args,
                address_tree,
                user,
                Some(0),
            )?;

            LightSystemProgramCpi::new_cpi(
                LIGHT_CPI_SIGNER,
                ValidityProof(args.compressed_proof_args.proof),
            )
            .with_light_account(account_info)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

            domain_config.authority = new_authority.key();
        }

        if args.new_origins.is_some() {
            domain_config.write_origins(args.new_origins.unwrap())?;
        }

        if args.new_metadata_url.is_some() {
            domain_config.write_metadata_url(args.new_metadata_url.unwrap())?;
        }

        Ok(())
    }
}

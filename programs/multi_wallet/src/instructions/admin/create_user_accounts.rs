use crate::{
    state::WhitelistedAddressTree,
    utils::{UserRole, SEED_WHITELISTED_ADDRESS_TREE},
    MemberKey, MultisigError, ProofArgs, User, UserCreationArgs, LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateUserAccountArgs {
    pub member: Pubkey,
    pub role: UserRole,
    pub transaction_manager_url: Option<String>,
    pub user_creation_args: UserCreationArgs,
}

#[derive(Accounts)]
pub struct CreateUserAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        seeds = [SEED_WHITELISTED_ADDRESS_TREE],
        bump = whitelisted_address_trees.bump
    )]
    pub whitelisted_address_trees: Account<'info, WhitelistedAddressTree>,
}

impl<'info> CreateUserAccounts<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        args: Vec<CreateUserAccountArgs>,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let mut new_addressess = vec![];
        let mut cpi = LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        );
        for args in args {
            require!(
                args.role.ne(&UserRole::Administrator),
                MultisigError::InvalidUserRole
            );
            require!(
                ctx.remaining_accounts
                    .iter()
                    .any(|f| f.key.eq(&args.member) && f.is_signer),
                MultisigError::NoSignerFound
            );

            let address_tree = &args
                .user_creation_args
                .address_tree_info
                .get_tree_pubkey(&light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

            let user_address_tree_index = ctx
                .accounts
                .whitelisted_address_trees
                .extract_address_tree_index(address_tree)?;

            let user = User {
                member: MemberKey::convert_ed25519(&args.member)?,
                role: args.role,
                delegated_to: None,
                domain_config: None,
                transaction_manager_url: args.transaction_manager_url,
                user_address_tree_index,
            };

            user.invariant()?;

            let (account_info, new_address_params) = User::create_user_account(
                args.user_creation_args,
                address_tree,
                user,
                Some(cpi.account_infos.len() as u8),
            )?;
            cpi = cpi.with_light_account(account_info)?;
            new_addressess.push(new_address_params);
        }

        cpi.with_new_addresses(&new_addressess)
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

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
    PackedAddressTreeInfoExt,
};
use std::collections::HashSet;

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
        let cpi_start = compressed_proof_args.light_cpi_accounts_start_index as usize;
        require!(
            cpi_start <= ctx.remaining_accounts.len(),
            MultisigError::InvalidNumberOfAccounts
        );
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts[cpi_start..],
            LIGHT_CPI_SIGNER,
        );

        let mut new_addresses = Vec::with_capacity(args.len());
        let signer_keys: HashSet<Pubkey> = ctx
            .remaining_accounts
            .iter()
            .filter(|account| account.is_signer)
            .map(|account| *account.key)
            .collect();
        let mut cpi = LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        );
        for args in args {
            require!(
                signer_keys.contains(&args.member),
                MultisigError::NoSignerFound
            );

            let address_tree = PackedAddressTreeInfoExt::get_tree_pubkey(
                &args.user_creation_args.address_tree_info,
                &light_cpi_accounts,
            )
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

            let user_address_tree_index = ctx
                .accounts
                .whitelisted_address_trees
                .extract_address_tree_index(&address_tree)?;

            let user = User {
                member: MemberKey::convert_ed25519(&args.member)?,
                role: args.role,
                wallets: Vec::new(),
                credential_id: None,
                transports: None,
                domain_config: None,
                transaction_manager_url: args.transaction_manager_url,
                user_address_tree_index,
            };

            let (account_info, new_address_params) = User::create_user_account(
                args.user_creation_args,
                &address_tree,
                user,
                Some(cpi.account_infos.len() as u8),
            )?;
            account_info.invariant()?;
            cpi = cpi.with_light_account(account_info)?;
            new_addresses.push(new_address_params);
        }

        cpi.with_new_addresses(&new_addresses)
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

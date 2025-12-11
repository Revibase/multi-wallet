use crate::{
    state::{SettingsIndexWithAddress, UserMutArgs, WhitelistedAddressTree},
    utils::{UserRole, SEED_WHITELISTED_ADDRESS_TREE},
    CompressedSettings, DomainConfig, Member, MemberKey, MultisigError, MultisigSettings,
    Permission, Permissions, ProofArgs, Secp256r1Pubkey, SettingsMutArgs, User, UserCreationArgs,
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    LightAccount,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct LinkWalletArgs {
    pub settings_mut_args: SettingsMutArgs,
    pub transaction_manager: Option<UserMutArgs>,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateDomainUserAccountArgs {
    pub member: Secp256r1Pubkey,
    pub role: UserRole,
    pub user_account_creation_args: UserCreationArgs,
    pub link_wallet_args: Option<LinkWalletArgs>,
}

#[derive(Accounts)]
pub struct CreateDomainUserAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    #[account(
        seeds = [SEED_WHITELISTED_ADDRESS_TREE],
        bump = whitelisted_address_trees.bump
    )]
    pub whitelisted_address_trees: Account<'info, WhitelistedAddressTree>,
}

impl<'info> CreateDomainUserAccount<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        args: CreateDomainUserAccountArgs,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let address_tree = &args
            .user_account_creation_args
            .address_tree_info
            .get_tree_pubkey(&light_cpi_accounts)
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let user_address_tree_index = ctx
            .accounts
            .whitelisted_address_trees
            .extract_address_tree_index(address_tree)?;

        let mut cpi = LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        );
        let mut delegated_to = None;
        //allow domain authority to directly link user to a particular wallet owned by the domain authority
        if let Some(link_wallet_args) = args.link_wallet_args {
            let mut settings_account = LightAccount::<CompressedSettings>::new_mut(
                &crate::ID,
                &link_wallet_args.settings_mut_args.account_meta,
                link_wallet_args.settings_mut_args.data,
            )
            .map_err(ProgramError::from)?;

            let settings_data = settings_account
                .data
                .as_ref()
                .ok_or(MultisigError::InvalidArguments)?;

            delegated_to = Some(SettingsIndexWithAddress {
                index: settings_data.index,
                settings_address_tree_index: settings_data.settings_address_tree_index,
            });

            require!(
                settings_data.threshold == 1
                    && settings_data.members.len() == 1
                    && settings_data.members[0]
                        .pubkey
                        .eq(&MemberKey::convert_ed25519(ctx.accounts.authority.key)?)
                    && UserRole::from(settings_data.members[0].role).eq(&UserRole::Administrator),
                MultisigError::InvalidArguments
            );

            let mut new_members = Vec::new();

            let mut permissions = vec![Permission::VoteTransaction, Permission::ExecuteTransaction];

            if let Some(transaction_manger) = link_wallet_args.transaction_manager {
                let transaction_manager_account = LightAccount::<User>::new_mut(
                    &crate::ID,
                    &transaction_manger.account_meta,
                    transaction_manger.data,
                )
                .map_err(ProgramError::from)?;

                require!(
                    transaction_manager_account
                        .transaction_manager_url
                        .is_some()
                        && transaction_manager_account
                            .role
                            .eq(&UserRole::TransactionManager),
                    MultisigError::ExpectedTransactionManagerRoleMismatch
                );

                new_members.push(Member {
                    pubkey: transaction_manager_account.member,
                    permissions: Permissions::from_permissions(vec![
                        Permission::InitiateTransaction,
                    ]),
                    role: UserRole::TransactionManager.to_u8(),
                    user_address_tree_index: transaction_manager_account.user_address_tree_index,
                    is_delegate: false.into(),
                });
                cpi = cpi.with_light_account(transaction_manager_account)?;
            } else {
                permissions.push(Permission::InitiateTransaction);
            }

            new_members.push(Member {
                pubkey: MemberKey::convert_secp256r1(&args.member)?,
                permissions: Permissions::from_permissions(permissions),
                role: args.role.to_u8(),
                user_address_tree_index,
                is_delegate: true.into(),
            });

            settings_account.set_members(new_members)?;

            settings_account.invariant()?;

            cpi = cpi.with_light_account(settings_account)?;
        }

        let user = User {
            member: MemberKey::convert_secp256r1(&args.member)?,
            role: args.role,
            domain_config: Some(ctx.accounts.domain_config.key()),
            delegated_to,
            transaction_manager_url: None,
            user_address_tree_index,
        };

        user.invariant()?;

        let (account_info, new_address_params) = User::create_user_account(
            args.user_account_creation_args,
            address_tree,
            user,
            Some(cpi.account_infos.len() as u8),
        )?;

        cpi.with_light_account(account_info)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

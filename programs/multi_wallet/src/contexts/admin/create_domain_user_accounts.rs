use crate::{
    state::UserMutArgs, CompressedSettings, DomainConfig, Member, MemberKey, MultisigError,
    MultisigSettings, Permission, Permissions, ProofArgs, Secp256r1Pubkey, SettingsMutArgs, User,
    UserCreationArgs, LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
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
    pub is_permanent_member: bool,
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

        let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof);
        let mut settings_index = None;
        let mut transaction_manager_url = None;
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

            settings_index = Some(settings_data.index);

            require!(
                settings_data.threshold == 1
                    && settings_data.members.len() == 1
                    && settings_data.members[0]
                        .pubkey
                        .eq(&MemberKey::convert_ed25519(ctx.accounts.authority.key)?)
                    && !settings_data.members[0]
                        .permissions
                        .has(Permission::IsPermanentMember),
                MultisigError::InvalidArguments
            );

            let mut new_members = Vec::new();

            let mut permissions = vec![Permission::VoteTransaction, Permission::ExecuteTransaction];

            if args.is_permanent_member {
                permissions.push(Permission::IsPermanentMember);
            }

            // If transaction manager is provided, ensure it has a valid API URL and add the authority as a transaction manager
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
                        .is_some(),
                    MultisigError::InvalidAccount
                );

                transaction_manager_url =
                    transaction_manager_account.transaction_manager_url.clone();

                new_members.push(Member {
                    pubkey: transaction_manager_account.member,
                    permissions: Permissions::from_permissions(vec![
                        Permission::InitiateTransaction,
                        Permission::IsTransactionManager,
                    ]),
                });
                cpi = cpi.with_light_account(transaction_manager_account)?;
            } else {
                permissions.push(Permission::InitiateTransaction);
            }

            new_members.push(Member {
                pubkey: MemberKey::convert_secp256r1(&args.member)?,
                permissions: Permissions::from_permissions(permissions),
            });

            settings_account.set_members(new_members)?;

            settings_account.invariant()?;

            cpi = cpi.with_light_account(settings_account)?;
        }

        let (account_info, new_address_params) = User::create_user_account(
            args.user_account_creation_args,
            &light_cpi_accounts,
            User {
                member: MemberKey::convert_secp256r1(&args.member)?,
                is_permanent_member: args.is_permanent_member,
                domain_config: Some(ctx.accounts.domain_config.key()),
                settings_index,
                transaction_manager_url,
            },
            Some(cpi.account_infos.len() as u8),
        )?;

        cpi.with_light_account(account_info)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

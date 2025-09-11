use crate::{
    error::MultisigError,
    state::{
        CompressedSettings, CreateUserArgs, DomainConfig, Member, MemberKey, MultisigSettings,
        Permission, Permissions, ProofArgs, Secp256r1Pubkey, SettingsMutArgs, User,
        UserCreationArgs,
    },
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    cpi::{CpiAccounts, CpiInputs},
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateDomainUserArgs {
    pub member: Secp256r1Pubkey,
    pub is_permanent_member: bool,
    pub user_creation_args: UserCreationArgs,
    pub link_wallet_args: Option<SettingsMutArgs>,
}

#[derive(Accounts)]
pub struct CreateDomainUsers<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
}

impl<'info> CreateDomainUsers<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        create_user_args: Vec<CreateDomainUserArgs>,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let mut account_infos = vec![];
        let mut new_addressess = vec![];

        for args in create_user_args {
            let mut settings_index = None;
            //allow domain authority to directly link domain user to a particular wallet owned by the domain authority
            if let Some(link_wallet_args) = args.link_wallet_args {
                let mut settings_account = LightAccount::<'_, CompressedSettings>::new_mut(
                    &crate::ID,
                    &link_wallet_args.account_meta,
                    link_wallet_args.data,
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

                let mut permissions = vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ];

                if args.is_permanent_member {
                    permissions.push(Permission::IsPermanentMember);
                }

                settings_account.set_members(vec![Member {
                    pubkey: MemberKey::convert_secp256r1(&args.member)?,
                    permissions: Permissions::from_permissions(permissions),
                }])?;

                settings_account.invariant()?;

                account_infos.push(
                    settings_account
                        .to_account_info()
                        .map_err(ProgramError::from)?,
                );
            }

            let (account_info, new_address_params) = User::create_user_account(
                args.user_creation_args,
                &light_cpi_accounts,
                CreateUserArgs {
                    member: MemberKey::convert_secp256r1(&args.member)?,
                    is_permanent_member: args.is_permanent_member,
                },
                Some(ctx.accounts.domain_config.key()),
                settings_index,
            )?;
            account_infos.push(account_info);
            new_addressess.push(new_address_params);
        }

        let cpi_inputs =
            CpiInputs::new_with_address(compressed_proof_args.proof, account_infos, new_addressess);

        cpi_inputs
            .invoke_light_system_program(light_cpi_accounts)
            .unwrap();
        Ok(())
    }
}

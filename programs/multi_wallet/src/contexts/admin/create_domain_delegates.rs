use crate::{
    CompressedSettings, Delegate, DelegateCreationArgs, DelegateExtensions, DomainConfig, Member,
    MemberKey, MultisigError, MultisigSettings, Permission, Permissions, ProofArgs,
    Secp256r1Pubkey, SettingsMutArgs, LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v1::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    LightAccount,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct LinkWalletArgs {
    pub settings_mut_args: SettingsMutArgs,
    pub delegate_extension_authority: Option<Pubkey>,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateDomainDelegateArg {
    pub member: Secp256r1Pubkey,
    pub is_permanent_member: bool,
    pub delegate_creation_args: DelegateCreationArgs,
    pub link_wallet_args: Option<LinkWalletArgs>,
}

#[derive(Accounts)]
pub struct CreateDomainDelegates<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
}

impl<'info> CreateDomainDelegates<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        create_delegate_args: Vec<CreateDomainDelegateArg>,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let mut new_addressess = vec![];

        let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof);

        for args in create_delegate_args {
            let mut settings_index = None;
            //allow domain authority to directly link domain delegate to a particular wallet owned by the domain authority
            if let Some(link_wallet_args) = args.link_wallet_args {
                let mut settings_account = LightAccount::<'_, CompressedSettings>::new_mut(
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

                let mut permissions =
                    vec![Permission::VoteTransaction, Permission::ExecuteTransaction];

                if args.is_permanent_member {
                    permissions.push(Permission::IsPermanentMember);
                }

                // If delegate_extensions is provided, ensure it has a valid API URL and add the authority as a transaction manager
                if let Some(delegate_extension_authority) =
                    link_wallet_args.delegate_extension_authority
                {
                    let member_key = MemberKey::convert_ed25519(&delegate_extension_authority)?;
                    let delegate_extension_account =
                        DelegateExtensions::extract_delegate_extension(
                            member_key,
                            ctx.remaining_accounts,
                        )?;
                    let delegate_extension = delegate_extension_account.load()?;
                    require!(
                        delegate_extension.api_url_len > 0,
                        MultisigError::InvalidAccount
                    );
                    new_members.push(Member {
                        pubkey: member_key,
                        permissions: Permissions::from_permissions(vec![
                            Permission::InitiateTransaction,
                            Permission::IsTransactionManager,
                        ]),
                    });
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

            let (account_info, new_address_params) = Delegate::create_delegate_account(
                args.delegate_creation_args,
                &light_cpi_accounts,
                Delegate {
                    member: MemberKey::convert_secp256r1(&args.member)?,
                    is_permanent_member: args.is_permanent_member,
                    domain_config: Some(ctx.accounts.domain_config.key()),
                    settings_index,
                },
            )?;
            cpi = cpi.with_light_account(account_info)?;
            new_addressess.push(new_address_params);
        }
        cpi.with_new_addresses(&new_addressess)
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

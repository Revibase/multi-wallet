use crate::{
    state::SettingsIndexWithDelegateInfo,
    utils::{resize_account_if_necessary, Transports, UserRole, SEED_USER},
    DomainConfig, Member, MemberKey, MultisigError, Permission, Permissions, Secp256r1Pubkey,
    Settings, User,
};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateDomainUserAccountArgs {
    pub member: Secp256r1Pubkey,
    pub role: UserRole,
    pub credential_id: Vec<u8>,
    pub transports: Vec<Transports>,
}

#[derive(Accounts)]
#[instruction(args: CreateDomainUserAccountArgs)]
pub struct CreateDomainUserAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub domain_config: AccountLoader<'info, DomainConfig>,
    #[account(
        address = domain_config.load()?.authority,
    )]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = User::size(args.credential_id.len(),args.transports.len(), 0, if settings.is_some() {1} else {0} ),
        seeds = [SEED_USER, &MemberKey::new(crate::utils::KeyType::Secp256r1, args.member.to_bytes())?.get_seed()?],
        bump
    )]
    pub user_account: Account<'info, User>,
    pub transaction_manager_account: Option<Account<'info, User>>,
    #[account(mut)]
    pub settings: Option<Account<'info, Settings>>,
    pub system_program: Program<'info, System>,
}

impl<'info> CreateDomainUserAccount<'info> {
    pub fn process(
        ctx: Context<'info, Self>,
        args: CreateDomainUserAccountArgs,
    ) -> Result<()> {
        let mut wallets = Vec::with_capacity(1);
        // This operation transfers ownership - the administrator is removed and replaced with new members.
        // This is intentional as the domain authority is transferring control of the wallet.
        if let Some(settings_account) = &mut ctx.accounts.settings {
            wallets.push(SettingsIndexWithDelegateInfo {
                index: settings_account.index,
                is_delegate: true,
            });

            require!(
                settings_account.threshold == 1
                    && settings_account.members.len() == 1
                    && settings_account.members[0]
                        .pubkey
                        .eq(&MemberKey::convert_ed25519(ctx.accounts.authority.key)?)
                    && UserRole::from(settings_account.members[0].role)
                        .eq(&UserRole::Administrator),
                MultisigError::ExpectedAdministratorRoleMismatch
            );

            let mut new_members = Vec::with_capacity(2);

            let mut permissions = vec![Permission::VoteTransaction, Permission::ExecuteTransaction];

            if let Some(transaction_manager) = &ctx.accounts.transaction_manager_account {
                require!(
                    transaction_manager.transaction_manager_url.is_some()
                        && transaction_manager.role.eq(&UserRole::TransactionManager),
                    MultisigError::ExpectedTransactionManagerRoleMismatch
                );

                new_members.push(Member::new(
                    transaction_manager.member,
                    UserRole::TransactionManager,
                    Permissions::from_permissions(vec![Permission::InitiateTransaction]),
                    false,
                ));
            } else {
                permissions.push(Permission::InitiateTransaction);
            }

            new_members.push(Member::new(
                MemberKey::convert_secp256r1(&args.member)?,
                args.role,
                Permissions::from_permissions(permissions),
                true,
            ));

            let new_size = Settings::size(new_members.len());

            resize_account_if_necessary(
                &settings_account.to_account_info(),
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                new_size,
            )?;

            settings_account.set_members(new_members)?;

            settings_account.invariant()?;
        }

        let user = &mut ctx.accounts.user_account;
        user.member = MemberKey::convert_secp256r1(&args.member)?;
        user.role = args.role;
        user.wallets = wallets;
        user.transports = Some(args.transports);
        user.credential_id = Some(args.credential_id);
        user.domain_config = Some(ctx.accounts.domain_config.key());
        user.transaction_manager_url = None;
        user.bump = ctx.bumps.user_account;

        user.invariant()?;

        Ok(())
    }
}

use crate::{
    error::MultisigError,
    state::{DomainConfig, User},
    utils::{MemberKey, UserRole, SEED_DOMAIN_CONFIG, SEED_USER},
};
use anchor_lang::prelude::*;
use light_sdk::hasher::{Hasher, Sha256};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateDomainConfigArgs {
    rp_id: String,
    origins: Vec<String>,
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
        init,
        payer = payer,
        space = User::size(0, 0, 0),
        seeds = [SEED_USER, authority.key.as_ref()],
        bump
    )]
    pub user_account: Account<'info, User>,
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

        let authority_key = ctx.accounts.authority.key();

        let user = &mut ctx.accounts.user_account;
        user.member = MemberKey::convert_ed25519(&authority_key)?;
        user.role = UserRole::Administrator;
        user.wallets = Vec::new();
        user.transports = None;
        user.credential_id = None;
        user.domain_config = Some(ctx.accounts.domain_config.key());
        user.transaction_manager_url = None;
        user.bump = ctx.bumps.user_account;

        user.invariant()?;

        let domain_config = &mut ctx.accounts.domain_config.load_init()?;
        domain_config.rp_id_hash = Sha256::hash(args.rp_id.as_bytes())
            .map_err(|_| MultisigError::HashComputationFailed)?;
        domain_config.write_rp_id(args.rp_id)?;
        domain_config.write_origins(&args.origins)?;
        domain_config.authority = authority_key;
        domain_config.bump = ctx.bumps.domain_config;
        domain_config.is_disabled = 0;

        Ok(())
    }
}

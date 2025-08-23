use crate::{
    state::{
        CreateUserArgs, DomainConfig, MemberKey, ProofArgs, Secp256r1Pubkey, Transport, User,
        UserCreationArgs,
    },
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::cpi::{CpiAccounts, CpiInputs};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateDomainUserArgs {
    pub member: Secp256r1Pubkey,
    pub credential_id: Vec<u8>,
    pub mint: Option<Pubkey>,
    pub username: Option<String>,
    pub expiry: Option<u64>,
    pub is_permanent_member: bool,
    pub user_creation_args: UserCreationArgs,
    pub transports: Vec<Transport>,
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
            let (account_info, new_address_params) = User::create_user_account(
                args.user_creation_args,
                &light_cpi_accounts,
                CreateUserArgs {
                    member: MemberKey::convert_secp256r1(&args.member)?,
                    credential_id: Some(args.credential_id),
                    mint: args.mint,
                    username: args.username,
                    expiry: args.expiry,
                    is_permanent_member: args.is_permanent_member,
                    transports: Some(args.transports),
                },
                Some(ctx.accounts.domain_config.key()),
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

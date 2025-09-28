use crate::{
    error::MultisigError,
    state::{CreateUserArgs, MemberKey, ProofArgs, User, UserCreationArgs, UserExtensions},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::cpi::{CpiAccounts, CpiInputs};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateGlobalUserArgs {
    pub member: Pubkey,
    pub is_permanent_member: bool,
    pub user_creation_args: UserCreationArgs,
    pub api_url: Option<String>,
}

#[derive(Accounts)]
pub struct CreateGlobalUsers<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CreateGlobalUsers<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        create_user_args: Vec<CreateGlobalUserArgs>,
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
            let signer = ctx
                .remaining_accounts
                .iter()
                .find(|f| f.key.eq(&args.member));

            require!(
                signer.is_some() && signer.unwrap().is_signer,
                MultisigError::NoSignerFound
            );

            if let Some(api_url) = args.api_url {
                UserExtensions::initialize(
                    api_url,
                    &args.member,
                    ctx.remaining_accounts,
                    &ctx.accounts.payer,
                    &ctx.accounts.system_program,
                )?;
            }

            let (account_info, new_address_params) = User::create_user_account(
                args.user_creation_args,
                &light_cpi_accounts,
                CreateUserArgs {
                    member: MemberKey::convert_ed25519(&args.member)?,
                    is_permanent_member: args.is_permanent_member,
                },
                None,
                None,
            )?;
            account_infos.push(account_info);
            new_addressess.push(new_address_params);
        }

        let cpi_inputs =
            CpiInputs::new_with_address(compressed_proof_args.proof, account_infos, new_addressess);

        cpi_inputs
            .invoke_light_system_program(light_cpi_accounts)
            .map_err(ProgramError::from)?;
        Ok(())
    }
}

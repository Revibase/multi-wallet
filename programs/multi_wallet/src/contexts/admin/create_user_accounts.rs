use crate::{MemberKey, MultisigError, ProofArgs, User, UserCreationArgs, LIGHT_CPI_SIGNER};
use anchor_lang::prelude::*;
use light_sdk::cpi::{
    v1::{CpiAccounts, LightSystemProgramCpi},
    InvokeLightSystemProgram, LightCpiInstruction,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateUserAccountArgs {
    pub member: Pubkey,
    pub is_permanent_member: bool,
    pub transaction_manager_url: Option<String>,
    pub user_creation_args: UserCreationArgs,
}

#[derive(Accounts)]
pub struct CreateUserAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
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
        let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof);
        for args in args {
            let signer = ctx
                .remaining_accounts
                .iter()
                .find(|f| f.key.eq(&args.member));

            require!(
                signer.is_some() && signer.unwrap().is_signer,
                MultisigError::NoSignerFound
            );

            require!(
                (args.transaction_manager_url.is_none() || !args.is_permanent_member),
                MultisigError::InvalidArguments
            );

            let (account_info, new_address_params) = User::create_user_account(
                args.user_creation_args,
                &light_cpi_accounts,
                User {
                    member: MemberKey::convert_ed25519(&args.member)?,
                    is_permanent_member: args.is_permanent_member,
                    settings_index: None,
                    domain_config: None,
                    transaction_manager_url: args.transaction_manager_url,
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

use crate::{
    state::{CreateUserArgs, MemberKey, ProofArgs, User, UserCreationArgs},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::cpi::{CpiAccounts, CpiInputs};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateGlobalUserArgs {
    pub member: Pubkey,
    pub user_creation_args: UserCreationArgs,
}

#[derive(Accounts)]
pub struct CreateGlobalUsers<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
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
            let (account_info, new_address_params) = User::create_user_account(
                args.user_creation_args,
                &light_cpi_accounts,
                CreateUserArgs {
                    member: MemberKey::convert_ed25519(&args.member)?,
                    credential_id: None,
                    mint: None,
                    username: None,
                    expiry: None,
                    is_permanent_member: false,
                    transports: None,
                },
                None,
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

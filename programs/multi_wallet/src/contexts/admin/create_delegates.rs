use crate::{
    Delegate, DelegateCreationArgs, DelegateExtensions, MemberKey, MultisigError, ProofArgs,
    LIGHT_CPI_SIGNER,
};
use anchor_lang::prelude::*;
use light_sdk::cpi::{
    v1::{CpiAccounts, LightSystemProgramCpi},
    InvokeLightSystemProgram, LightCpiInstruction,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateDelegateArg {
    pub member: Pubkey,
    pub is_permanent_member: bool,
    pub delegate_creation_args: DelegateCreationArgs,
    pub api_url: Option<String>,
}

#[derive(Accounts)]
pub struct CreateDelegates<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CreateDelegates<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        create_delegate_args: Vec<CreateDelegateArg>,
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
            let signer = ctx
                .remaining_accounts
                .iter()
                .find(|f| f.key.eq(&args.member));

            require!(
                signer.is_some() && signer.unwrap().is_signer,
                MultisigError::NoSignerFound
            );

            if let Some(api_url) = args.api_url {
                DelegateExtensions::initialize(
                    api_url,
                    &args.member,
                    ctx.remaining_accounts,
                    &ctx.accounts.payer,
                    &ctx.accounts.system_program,
                )?;
            }

            let (account_info, new_address_params) = Delegate::create_delegate_account(
                args.delegate_creation_args,
                &light_cpi_accounts,
                Delegate {
                    member: MemberKey::convert_ed25519(&args.member)?,
                    is_permanent_member: args.is_permanent_member,
                    settings_index: None,
                    domain_config: None,
                },
                0,
            )?;
            cpi = cpi.with_light_account(account_info)?;
            new_addressess.push(new_address_params);
        }

        cpi.with_new_addresses(&new_addressess)
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

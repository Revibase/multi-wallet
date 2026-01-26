use crate::{
    id,
    state::{SettingsIndexWithAddress, UserReadOnlyOrMutateArgs, WhitelistedAddressTree},
    utils::{SEED_GLOBAL_COUNTER, SEED_WHITELISTED_ADDRESS_TREE},
    AddMemberArgs, CompressedSettings, CompressedSettingsData, GlobalCounter, MemberKey,
    MultisigError, Permission, Permissions, ProofArgs, SettingsCreationArgs, User,
    UserWalletOperation, LIGHT_CPI_SIGNER, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::prelude::*;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    PackedAddressTreeInfoExt,
};

#[derive(Accounts)]
pub struct CreateCompressedWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub initial_member: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        mut,
        seeds = [SEED_GLOBAL_COUNTER],
        bump
    )]
    pub global_counter: AccountLoader<'info, GlobalCounter>,
    #[account(
        seeds = [SEED_WHITELISTED_ADDRESS_TREE],
        bump = whitelisted_address_trees.bump
    )]
    pub whitelisted_address_trees: Account<'info, WhitelistedAddressTree>,
}

impl<'info> CreateCompressedWallet<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        compressed_proof_args: ProofArgs,
        settings_creation: SettingsCreationArgs,
        user_args: UserReadOnlyOrMutateArgs,
        settings_index: u128,
    ) -> Result<()> {
        let global_counter = &mut ctx.accounts.global_counter.load_mut()?;
        require!(
            settings_index.eq(&global_counter.index),
            MultisigError::InvalidArguments
        );
        let (settings_key, bump) = Pubkey::find_program_address(
            &[SEED_MULTISIG, settings_index.to_le_bytes().as_ref()],
            &crate::ID,
        );

        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[SEED_MULTISIG, settings_key.as_ref(), SEED_VAULT],
            &id(),
        );

        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );
        let address_tree = PackedAddressTreeInfoExt::get_tree_pubkey(
            &settings_creation.address_tree_info,
            &light_cpi_accounts,
        )
        .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let settings_address_tree_index = ctx
            .accounts
            .whitelisted_address_trees
            .extract_address_tree_index(&address_tree)?;

        let (mut settings_account, settings_new_address) =
            CompressedSettings::create_compressed_settings_account(
                settings_creation,
                &address_tree,
                CompressedSettingsData {
                    threshold: 1,
                    bump,
                    index: settings_index,
                    multi_wallet_bump: multi_wallet_bump,
                    members: vec![],
                    settings_address_tree_index,
                    latest_slot_number: 0u64,
                },
                Some(0),
            )?;

        let wallet_operations = settings_account.add_members(vec![AddMemberArgs {
            member_key: MemberKey::convert_ed25519(&ctx.accounts.initial_member.key())?,
            permissions: Permissions::from_permissions(vec![
                Permission::InitiateTransaction,
                Permission::VoteTransaction,
                Permission::ExecuteTransaction,
            ]),
            user_args,
        }])?;

        settings_account.invariant()?;

        let account_infos = User::process_user_wallet_operations(
            wallet_operations
                .into_iter()
                .map(UserWalletOperation::Add)
                .collect(),
            SettingsIndexWithAddress {
                index: settings_index,
                settings_address_tree_index,
            },
            &light_cpi_accounts,
        )?;

        let mut cpi = LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .with_new_addresses(&[settings_new_address]);

        for user_account in account_infos {
            user_account.invariant()?;
            cpi = cpi.with_light_account(user_account)?;
        }

        cpi.invoke(light_cpi_accounts)?;

        global_counter.index += 1;
        Ok(())
    }
}

use crate::{
    id,
    state::{SettingsIndexWithAddress, UserReadOnlyOrMutateArgs, WhitelistedAddressTree},
    utils::SEED_WHITELISTED_ADDRESS_TREE,
    AddMemberArgs, CompressedSettings, CompressedSettingsData, DomainConfig, GlobalCounter, Member,
    MemberKey, MultisigError, Ops, Permission, Permissions, ProofArgs, Secp256r1VerifyArgs,
    SettingsCreationArgs, User, UserMutArgs, LIGHT_CPI_SIGNER, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
};

#[derive(Accounts)]
pub struct CreateMultiWalletCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub initial_member: Option<Signer<'info>>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    #[account(mut)]
    pub global_counter: AccountLoader<'info, GlobalCounter>,
    #[account(
        seeds = [SEED_WHITELISTED_ADDRESS_TREE],
        bump = whitelisted_address_trees.bump
    )]
    pub whitelisted_address_trees: Account<'info, WhitelistedAddressTree>,
}

impl<'info> CreateMultiWalletCompressed<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        compressed_proof_args: ProofArgs,
        settings_creation: SettingsCreationArgs,
        user_mut_args: UserMutArgs,
        settings_index: u128,
        set_as_delegate: bool,
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

        let signer: MemberKey = MemberKey::get_signer(
            &ctx.accounts.initial_member,
            &secp256r1_verify_args,
            ctx.accounts.instructions_sysvar.as_ref(),
        )?;

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
        let address_tree = &settings_creation
            .address_tree_info
            .get_tree_pubkey(&light_cpi_accounts)
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let settings_address_tree_index = ctx
            .accounts
            .whitelisted_address_trees
            .extract_address_tree_index(address_tree)?;

        let (mut settings_account, settings_new_address) =
            CompressedSettings::create_compressed_settings_account(
                settings_creation,
                address_tree,
                CompressedSettingsData {
                    threshold: 1,
                    bump,
                    index: settings_index,
                    multi_wallet_bump: multi_wallet_bump,
                    members: vec![],
                    settings_address_tree_index,
                },
                Some(0),
            )?;

        let mut permissions: Vec<Permission> = Vec::new();
        permissions.extend([
            Permission::InitiateTransaction,
            Permission::VoteTransaction,
            Permission::ExecuteTransaction,
        ]);
        if user_mut_args.data.is_permanent_member {
            permissions.push(Permission::IsPermanentMember);
        }

        let delegate_ops = settings_account.add_members(
            &settings_key,
            vec![AddMemberArgs {
                member: Member {
                    pubkey: signer,
                    permissions: Permissions::from_permissions(permissions),
                    user_address_tree_index: user_mut_args.data.user_address_tree_index,
                },
                verify_args: secp256r1_verify_args,
                user_args: UserReadOnlyOrMutateArgs::Mutate(user_mut_args),
                set_as_delegate,
            }],
            ctx.remaining_accounts,
            &ctx.accounts.slot_hash_sysvar,
            ctx.accounts.instructions_sysvar.as_ref(),
        )?;

        settings_account.invariant()?;

        let user_account_info = User::handle_user_delegates(
            delegate_ops.into_iter().map(Ops::Add).collect(),
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

        for account_info in user_account_info {
            cpi = cpi.with_light_account(account_info)?;
        }

        cpi.invoke(light_cpi_accounts)?;

        global_counter.index += 1;
        Ok(())
    }
}

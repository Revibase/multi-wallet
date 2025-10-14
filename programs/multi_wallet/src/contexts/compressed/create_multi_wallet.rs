use crate::{
    id, CompressedSettings, CompressedSettingsData, Delegate, DelegateMutArgs, DomainConfig,
    GlobalCounter, Member, MemberKey, MemberWithAddPermissionsArgs, MultisigError, Ops, Permission,
    Permissions, ProofArgs, Secp256r1VerifyArgs, SettingsCreationArgs, LIGHT_CPI_SIGNER,
    SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{
    v1::{CpiAccounts, LightSystemProgramCpi},
    InvokeLightSystemProgram, LightCpiInstruction,
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
}

impl<'info> CreateMultiWalletCompressed<'info> {
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        compressed_proof_args: ProofArgs,
        settings_creation: SettingsCreationArgs,
        delegate_mut_args: DelegateMutArgs,
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

        let data = CompressedSettingsData {
            threshold: 1,
            bump,
            index: settings_index,
            multi_wallet_bump: multi_wallet_bump,
            members: vec![],
        };

        let (mut settings_account, settings_new_address) =
            CompressedSettings::create_settings_account(
                settings_creation,
                data,
                &light_cpi_accounts,
            )?;

        let mut permissions: Vec<Permission> = Vec::new();
        permissions.extend([
            Permission::InitiateTransaction,
            Permission::VoteTransaction,
            Permission::ExecuteTransaction,
        ]);
        if delegate_mut_args.data.is_permanent_member {
            permissions.push(Permission::IsPermanentMember);
        }

        let delegate_ops = settings_account.add_members(
            &settings_key,
            vec![MemberWithAddPermissionsArgs {
                member: Member {
                    pubkey: signer,
                    permissions: Permissions::from_permissions(permissions),
                },
                verify_args: secp256r1_verify_args,
                delegate_args: delegate_mut_args,
                set_as_delegate,
            }],
            ctx.remaining_accounts,
            &ctx.accounts.slot_hash_sysvar,
            ctx.accounts.instructions_sysvar.as_ref(),
        )?;

        settings_account.invariant()?;

        let delegate_account_info = Delegate::handle_delegate_accounts(
            delegate_ops.into_iter().map(Ops::Create).collect(),
            settings_index,
        )?;

        let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, compressed_proof_args.proof)
            .with_light_account(settings_account)?
            .with_new_addresses(&[settings_new_address]);

        for f in delegate_account_info {
            cpi = cpi.with_light_account(f)?;
        }

        cpi.invoke(light_cpi_accounts)?;

        global_counter.index += 1;
        Ok(())
    }
}

use crate::{
    error::MultisigError,
    id,
    state::{
        CompressedSettings, Delegate, DelegateCreationArgs, DomainConfig, GlobalCounter, KeyType,
        Member, MemberKey, Permission, Permissions, ProofArgs, Secp256r1Pubkey,
        Secp256r1VerifyArgs, Settings, SettingsCreationArgs, TransactionActionType, SEED_MULTISIG,
        SEED_VAULT,
    },
    LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{CpiAccounts, CpiInputs};

#[derive(Accounts)]
#[instruction(secp256r1_verify_args: Option<Secp256r1VerifyArgs>)]
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
        permissions: Permissions,
        compressed_proof_args: ProofArgs,
        settings_creation_args: SettingsCreationArgs,
        delegate_creation_args: Option<DelegateCreationArgs>,
    ) -> Result<()> {
        let global_counter = &mut ctx.accounts.global_counter.load_mut()?;
        let (settings_key, bump) = Pubkey::find_program_address(
            &[SEED_MULTISIG, global_counter.index.to_le_bytes().as_ref()],
            &crate::ID,
        );
        let signer: MemberKey =
            MemberKey::get_signer(&ctx.accounts.initial_member, &secp256r1_verify_args)?;
        let domain_config = ctx.accounts.domain_config.as_ref().map(|f| f.key());

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let secp256r1_verify_data = secp256r1_verify_args
                .as_ref()
                .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            let rp_id_hash = ctx
                .accounts
                .domain_config
                .as_ref()
                .ok_or(MultisigError::DomainConfigIsMissing)?
                .load()?
                .rp_id_hash;

            Secp256r1Pubkey::verify_webauthn(
                secp256r1_verify_data,
                &ctx.accounts.slot_hash_sysvar,
                &ctx.accounts.domain_config,
                &settings_key,
                &rp_id_hash,
                TransactionActionType::AddNewMember,
                &ctx.accounts.instructions_sysvar,
            )?;
        }

        let (_, multi_wallet_bump) = Pubkey::find_program_address(
            &[SEED_MULTISIG, settings_key.as_ref(), SEED_VAULT],
            &id(),
        );
        let settings = Settings {
            threshold: 1,
            multi_wallet_bump,
            bump,
            index: global_counter.index,
            members: [Member {
                pubkey: signer,
                permissions,
                domain_config,
            }]
            .to_vec(),
        };
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );
        let (settings_info, settings_new_address) = CompressedSettings::create_settings_account(
            settings_creation_args,
            settings,
            &light_cpi_accounts,
        )?;

        let mut account_infos = vec![settings_info];
        let mut new_addresses = vec![settings_new_address];
        if permissions.has(Permission::IsDelegate) {
            let (account_info, new_address_params) = Delegate::create_delegate_account(
                delegate_creation_args,
                &signer,
                global_counter.index,
                &light_cpi_accounts,
            )?;
            account_infos.push(account_info);
            new_addresses.push(new_address_params);
        }

        if account_infos.len() > 0 || new_addresses.len() > 0 {
            let cpi_inputs = CpiInputs::new_with_address(
                compressed_proof_args.proof,
                account_infos,
                new_addresses,
            );
            cpi_inputs
                .invoke_light_system_program(light_cpi_accounts)
                .map_err(ProgramError::from)?;
        }

        global_counter.index += 1;
        Ok(())
    }
}

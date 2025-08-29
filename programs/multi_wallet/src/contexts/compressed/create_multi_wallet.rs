use crate::{
    error::MultisigError,
    id,
    state::{
        ChallengeArgs, CompressedMember, CompressedSettings, CompressedSettingsData, DomainConfig,
        GlobalCounter, KeyType, MemberKey, Permissions, ProofArgs, Secp256r1VerifyArgs,
        SettingsCreationArgs, TransactionActionType, User, UserMutArgs, SEED_MULTISIG, SEED_VAULT,
    },
    LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::cpi::{CpiAccounts, CpiInputs};

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
        permissions: Permissions,
        compressed_proof_args: ProofArgs,
        settings_creation: SettingsCreationArgs,
        user_mut_args: UserMutArgs,
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

        let signer: MemberKey = MemberKey::get_signer(
            &ctx.accounts.initial_member,
            &secp256r1_verify_args,
            ctx.accounts.instructions_sysvar.as_ref(),
        )?;
        let domain_config_key = ctx.accounts.domain_config.as_ref().map(|f| f.key());

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

            let instructions_sysvar = ctx
                .accounts
                .instructions_sysvar
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;

            let domain_config_key =
                domain_config_key.ok_or(MultisigError::DomainConfigIsMissing)?;
            secp256r1_verify_data.verify_webauthn(
                &ctx.accounts.slot_hash_sysvar,
                &ctx.accounts.domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: domain_config_key,
                    message_hash: rp_id_hash,
                    action_type: TransactionActionType::CreateNewWallet,
                },
            )?;
        }

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
            members: vec![CompressedMember {
                pubkey: signer,
                permissions,
                domain_config: domain_config_key,
            }],
        };

        let (settings_info, settings_new_address) = CompressedSettings::create_settings_account(
            settings_creation,
            data,
            &light_cpi_accounts,
        )?;

        let mut final_account_infos = vec![];
        let mut final_new_addresses = vec![];

        final_account_infos.push(User::handle_set_user_delegate(
            user_mut_args,
            settings_index,
            true,
            true,
        )?);

        final_account_infos.push(settings_info);
        final_new_addresses.push(settings_new_address);

        let cpi_inputs = CpiInputs::new_with_address(
            compressed_proof_args.proof,
            final_account_infos,
            final_new_addresses,
        );
        cpi_inputs
            .invoke_light_system_program(light_cpi_accounts)
            .map_err(ProgramError::from)?;

        global_counter.index += 1;
        Ok(())
    }
}

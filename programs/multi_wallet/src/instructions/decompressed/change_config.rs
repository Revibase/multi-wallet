use crate::{
    error::MultisigError,
    state::{DomainConfig, Ops, ProofArgs, Settings, SettingsIndexWithAddress, User},
    utils::{
        durable_nonce_check, resize_account_if_necessary, ChallengeArgs, MemberKey,
        MultisigSettings, Permission, Secp256r1VerifyArgsWithDomainAddress, TransactionActionType,
        SEED_MULTISIG,
    },
    ConfigAction, LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::ValidityProof,
    light_hasher::{Hasher, Sha256},
};
use std::vec;

#[derive(Accounts)]
#[instruction(settings_index: u128)]
pub struct ChangeConfig<'info> {
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,  
            settings_index.to_le_bytes().as_ref()
        ],
        bump = settings.bump
    )]
    pub settings: Account<'info, Settings>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> ChangeConfig<'info> {
    fn validate(
        &self,
        ctx: &Context<'_, '_, 'info, 'info, Self>,
        config_actions: &Vec<ConfigAction>,
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        let Self {
            settings,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let secp256r1_member_keys: Vec<(MemberKey, &Secp256r1VerifyArgsWithDomainAddress)> =
            secp256r1_verify_args
                .iter()
                .filter_map(|arg| {
                    let pubkey = arg
                        .verify_args
                        .extract_public_key_from_instruction(Some(&instructions_sysvar))
                        .ok()?;

                    let member_key = MemberKey::convert_secp256r1(&pubkey).ok()?;

                    Some((member_key, arg))
                })
                .collect();

        for member in &settings.get_members()? {
            let has_permission = |perm| member.permissions.has(perm);

            let secp256r1_signer = secp256r1_member_keys
                .iter()
                .find(|f| f.0.eq(&member.pubkey));
            let is_signer = secp256r1_signer.is_some()
                || ctx.remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .map_or(false, |key| key.eq(&member.pubkey))
                });

            if is_signer {
                if has_permission(Permission::InitiateTransaction) {
                    initiate = true;
                }
                if has_permission(Permission::ExecuteTransaction) {
                    execute = true;
                }
                if has_permission(Permission::VoteTransaction) {
                    vote_count += 1;
                }
            }

            if let Some((_, secp256r1_verify_data)) = secp256r1_signer {
                let mut writer = Vec::new();
                config_actions.serialize(&mut writer)?;
                let message_hash = Sha256::hash(&writer)
                    .map_err(|_| MultisigError::HashComputationFailed)?;

                let account_loader = DomainConfig::extract_domain_config_account(
                    ctx.remaining_accounts,
                    secp256r1_verify_data.domain_config_key,
                )?;

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: ctx.accounts.settings.key(),
                        message_hash,
                        action_type: TransactionActionType::ChangeConfig,
                    },
                    &[],
                )?;
            }
        }

        require!(
            initiate,
            MultisigError::InsufficientSignerWithInitiatePermission
        );
        require!(
            execute,
            MultisigError::InsufficientSignerWithExecutePermission
        );
        require!(
            vote_count >= settings.get_threshold()?,
            MultisigError::InsufficientSignersWithVotePermission
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &config_actions, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        _settings_index: u128,
        config_actions: Vec<ConfigAction>,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        compressed_proof_args: Option<ProofArgs>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let payer = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let mut delegate_ops: Vec<Ops> = vec![];
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    settings.edit_permissions(members)?;
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(members)?;
                    delegate_ops.extend(ops.into_iter().map(Ops::Add));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    delegate_ops.extend(ops.into_iter().map(Ops::Remove));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold)?;
                }
            }
        }

        resize_account_if_necessary(
            settings.as_ref(),
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            Settings::size(settings.get_members()?.len()),
        )?;

        let mut slot_numbers = Vec::with_capacity(secp256r1_verify_args.len());
        slot_numbers.extend(secp256r1_verify_args.iter().map(|f| f.verify_args.slot_number));
        settings.latest_slot_number_check(&slot_numbers, &ctx.accounts.slot_hash_sysvar)?;

        settings.invariant()?;

        if !delegate_ops.is_empty() {
            let compressed_proof_args =
                compressed_proof_args.ok_or(MultisigError::MissingCompressedProofArgs)?;
            let light_cpi_accounts = CpiAccounts::new(
                &payer,
                &remaining_accounts
                    [compressed_proof_args.light_cpi_accounts_start_index as usize..],
                LIGHT_CPI_SIGNER,
            );
            let account_infos = User::handle_user_delegates(
                delegate_ops,
                SettingsIndexWithAddress {
                    index: settings.index,
                    settings_address_tree_index: settings.settings_address_tree_index,
                },
                &light_cpi_accounts,
            )?;

            let mut cpi = LightSystemProgramCpi::new_cpi(
                LIGHT_CPI_SIGNER,
                ValidityProof(compressed_proof_args.proof),
            );

            for f in account_infos {
                cpi = cpi.with_light_account(f)?;
            }

            cpi.invoke(light_cpi_accounts)?;
        }

        Ok(())
    }
}

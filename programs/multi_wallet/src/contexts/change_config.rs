use std::{collections::HashMap, vec};

use crate::{
    error::MultisigError,
    state::{
        DomainConfig, MemberKey, Permission, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType,
    },
    utils::{
        close_delegate_account, create_delegate_account, durable_nonce_check, realloc_if_needed,
    },
    ConfigAction, ConfigEvent,
};
use anchor_lang::{
    prelude::*,
    solana_program::{hash::hash, sysvar::SysvarId},
};

#[derive(Accounts)]
pub struct ChangeConfig<'info> {
    #[account(mut)]
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

    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
}

#[derive(PartialEq, Eq)]
enum DelegateOp {
    Create(MemberKey),
    Close(MemberKey),
}

impl<'info> ChangeConfig<'info> {
    fn validate(
        &self,
        ctx: &Context<'_, '_, '_, 'info, Self>,
        config_actions: &Vec<ConfigAction>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let Self {
            settings,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;
        let threshold = settings.threshold as usize;
        let secp256r1_member_key = if secp256r1_verify_args.is_some() {
            Some(MemberKey::convert_secp256r1(
                &secp256r1_verify_args.as_ref().unwrap().public_key,
            )?)
        } else {
            None
        };

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);
            let is_secp256r1_signer =
                secp256r1_member_key.is_some() && member.pubkey.eq(&secp256r1_member_key.unwrap());
            let is_signer = is_secp256r1_signer
                || ctx.remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .unwrap()
                            .eq(&member.pubkey)
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

            if is_secp256r1_signer {
                let expected_domain_config = member
                    .domain_config
                    .ok_or(MultisigError::DomainConfigIsMissing)?;

                require!(
                    domain_config.is_some()
                        && domain_config
                            .as_ref()
                            .unwrap()
                            .key()
                            .eq(&expected_domain_config),
                    MultisigError::MemberDoesNotBelongToDomainConfig
                );

                let mut writer = Vec::new();
                for config in config_actions {
                    let mut serialized = Vec::new();
                    config.serialize(&mut serialized)?;

                    let length = serialized.len() as u16;
                    writer.extend_from_slice(&length.to_le_bytes());
                    writer.extend_from_slice(&serialized);
                }

                let message_hash = hash(&writer).to_bytes();

                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                Secp256r1Pubkey::verify_webauthn(
                    secp256r1_verify_data,
                    slot_hash_sysvar,
                    domain_config,
                    &settings.key(),
                    &message_hash,
                    TransactionActionType::ChangeConfig,
                    &Some(instructions_sysvar.clone()),
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
            vote_count >= threshold,
            MultisigError::InsufficientSignersWithVotePermission
        );

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &config_actions, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        config_actions: Vec<ConfigAction>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let slot_hash_sysvar = &ctx.accounts.slot_hash_sysvar;
        let settings = &mut ctx.accounts.settings;
        let system_program = &ctx.accounts.system_program;
        let payer = &ctx.accounts.payer;
        let remaining_accounts = ctx.remaining_accounts;

        let settings_account_info = settings.to_account_info();
        let current_size = settings_account_info.data_len();
        let settings_key = settings_account_info.key();

        let initial_member_pubkey = settings
            .members
            .iter()
            .find(|m| m.permissions.has(Permission::IsInitialMember))
            .map(|m| m.pubkey)
            .unwrap();

        let mut delegate_ops: Vec<DelegateOp> = vec![];
        for action in config_actions {
            match action {
                ConfigAction::EditPermissions(members) => {
                    settings.edit_permissions(members);
                }
                ConfigAction::AddMembers(members) => {
                    let ops = settings.add_members(
                        &settings_key,
                        members,
                        remaining_accounts,
                        slot_hash_sysvar,
                        &Some(ctx.accounts.instructions_sysvar.clone()),
                    )?;
                    delegate_ops.extend(ops.into_iter().map(DelegateOp::Create));
                }
                ConfigAction::RemoveMembers(members) => {
                    let ops = settings.remove_members(members)?;
                    delegate_ops.extend(ops.into_iter().map(DelegateOp::Close));
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.set_threshold(new_threshold);
                }
            }
        }

        let mut net_ops: HashMap<MemberKey, Option<DelegateOp>> = HashMap::new();

        for op in delegate_ops {
            let key = match op {
                DelegateOp::Create(pk) | DelegateOp::Close(pk) => pk,
            };
            match net_ops.get(&key) {
                Some(Some(prev)) if prev != &op => {
                    net_ops.insert(key, None); // cancel out
                }
                _ => {
                    net_ops.insert(key, Some(op));
                }
            }
        }
        let mut final_creates: Vec<MemberKey> = vec![];
        let mut final_closes: Vec<MemberKey> = vec![];
        for action in net_ops.values().flatten() {
            match action {
                DelegateOp::Create(pk) => final_creates.push(*pk),
                DelegateOp::Close(pk) => final_closes.push(*pk),
            }
        }

        for pk in final_creates {
            create_delegate_account(
                remaining_accounts,
                payer,
                system_program,
                &settings_key,
                &pk,
            )?
        }

        for pk in final_closes {
            close_delegate_account(remaining_accounts, payer, &pk)?
        }

        realloc_if_needed(
            &settings.to_account_info(),
            current_size,
            Settings::size(settings.members.len()),
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;

        settings.invariant(&initial_member_pubkey)?;

        emit!(ConfigEvent {
            members: settings.members.clone(),
            threshold: settings.threshold,
        });

        Ok(())
    }
}

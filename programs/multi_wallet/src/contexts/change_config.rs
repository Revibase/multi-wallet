use crate::{
    error::MultisigError,
    id,
    state::{
        DomainConfig, MemberKey, Permission, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType, SEED_MULTISIG, SEED_VAULT,
    },
    utils::realloc_if_needed,
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

    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
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
            ..
        } = self;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;
        let threshold = settings.threshold as usize;

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);
            let is_signer = secp256r1_verify_args.as_ref().map_or(
                ctx.remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .unwrap()
                            .eq(&member.pubkey)
                }),
                |args| {
                    member
                        .pubkey
                        .eq(&MemberKey::convert_secp256r1(&args.pubkey).unwrap())
                },
            );

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

        if secp256r1_verify_args.is_some() {
            let member = settings
                .members
                .iter()
                .find(|x| {
                    x.pubkey.eq(&MemberKey::convert_secp256r1(
                        &secp256r1_verify_args.as_ref().unwrap().pubkey,
                    )
                    .unwrap())
                })
                .ok_or(MultisigError::MissingAccount)?;

            let metadata = member.metadata.ok_or(MultisigError::MissingMetadata)?;

            require!(
                domain_config.is_some() && domain_config.as_ref().unwrap().key().eq(&metadata),
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
            )?;
        }

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
        let settings_account_info = settings.to_account_info();
        let current_size = settings_account_info.data.borrow().len();
        let settings_key = settings_account_info.key();
        let remaining_accounts = ctx.remaining_accounts;
        for action in config_actions {
            match action {
                ConfigAction::AddMembers(members) => {
                    let multi_wallet = Pubkey::create_program_address(
                        &[
                            SEED_MULTISIG,
                            settings.key().as_ref(),
                            SEED_VAULT,
                            &[settings.multi_wallet_bump],
                        ],
                        &id(),
                    )
                    .unwrap();
                    settings.add_members(
                        &settings_key,
                        &multi_wallet,
                        members,
                        remaining_accounts,
                        payer,
                        system_program,
                        slot_hash_sysvar,
                    )?;
                }
                ConfigAction::RemoveMembers(members) => {
                    settings.remove_members(members, remaining_accounts, payer)?;
                }
                ConfigAction::SetMembers(members) => {
                    settings.set_members(
                        &settings_key,
                        members,
                        remaining_accounts,
                        payer,
                        system_program,
                        slot_hash_sysvar,
                    )?;
                }
                ConfigAction::SetThreshold(new_threshold) => {
                    settings.threshold = new_threshold;
                }
                ConfigAction::SetMetadata(metadata) => {
                    settings.metadata = metadata;
                }
            }
        }

        realloc_if_needed(
            &settings.to_account_info(),
            current_size,
            Settings::size(settings.members.len()),
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;

        settings.invariant()?;

        emit!(ConfigEvent {
            create_key: settings.create_key,
            members: settings.members.clone(),
            threshold: settings.threshold,
            metadata: settings.metadata,
        });

        Ok(())
    }
}

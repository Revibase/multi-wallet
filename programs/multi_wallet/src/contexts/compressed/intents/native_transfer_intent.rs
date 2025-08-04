use crate::{
    state::{
        ChallengeArgs, CompressedSettings, CompressedSettingsData, DomainConfig, MemberKey,
        ProofArgs, Secp256r1VerifyArgs, SettingsReadonlyArgs, TransactionActionType, SEED_MULTISIG,
    },
    utils::durable_nonce_check,
    MultisigError, Permission, SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::{hash::hash, sysvar::SysvarId},
    system_program::{transfer, Transfer},
};

#[derive(Accounts)]
#[instruction(amount: u64,secp256r1_verify_args: Option<Secp256r1VerifyArgs>,settings_readonly: SettingsReadonlyArgs,)]
pub struct NativeTransferIntentCompressed<'info> {
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

    /// CHECK: checked in instruction
    #[account(mut)]
    pub source: UncheckedAccount<'info>,

    /// CHECK:
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> NativeTransferIntentCompressed<'info> {
    fn validate(
        &self,
        amount: u64,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        remaining_accounts: &[AccountInfo<'info>],
        settings: &CompressedSettingsData,
    ) -> Result<()> {
        let Self {
            domain_config,
            slot_hash_sysvar,
            destination,
            system_program,
            instructions_sysvar,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let threshold = settings.threshold as usize;
        let secp256r1_member_key =
            MemberKey::get_signer(&None, secp256r1_verify_args, Some(instructions_sysvar))
                .map_or(None, |f| Some(f));

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);
            let is_secp256r1_signer =
                secp256r1_member_key.is_some() && member.pubkey.eq(&secp256r1_member_key.unwrap());
            let is_signer = is_secp256r1_signer
                || remaining_accounts.iter().any(|account| {
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
                require!(
                    member.domain_config.is_some(),
                    MultisigError::DomainConfigIsMissing
                );

                require!(
                    domain_config.is_some()
                        && domain_config
                            .as_ref()
                            .unwrap()
                            .key()
                            .eq(&member.domain_config.unwrap()),
                    MultisigError::MemberDoesNotBelongToDomainConfig
                );

                let mut buffer = vec![];
                buffer.extend_from_slice(amount.to_le_bytes().as_ref());
                buffer.extend_from_slice(destination.key().as_ref());
                buffer.extend_from_slice(system_program.key().as_ref());
                let message_hash = hash(&buffer).to_bytes();

                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                secp256r1_verify_data.verify_webauthn(
                    slot_hash_sysvar,
                    domain_config,
                    instructions_sysvar,
                    ChallengeArgs {
                        account: system_program.key(),
                        message_hash,
                        action_type: TransactionActionType::NativeTransferIntent,
                    },
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

    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        amount: u64,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_readonly: SettingsReadonlyArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let (settings, settings_key) = CompressedSettings::verify_compressed_settings(
            &ctx.accounts.source.to_account_info(),
            true,
            &settings_readonly,
            ctx.remaining_accounts,
            &compressed_proof_args,
        )?;

        ctx.accounts.validate(
            amount,
            &secp256r1_verify_args,
            ctx.remaining_accounts,
            &settings,
        )?;

        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

        let multi_wallet = Pubkey::create_program_address(signer_seeds, &crate::id()).unwrap();
        require!(
            ctx.accounts.source.key().eq(&multi_wallet),
            MultisigError::InvalidAccount
        );

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            amount,
        )?;

        Ok(())
    }
}

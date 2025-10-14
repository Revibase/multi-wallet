use crate::{
    durable_nonce_check, ChallengeArgs, CompressedSettings, CompressedSettingsData, DomainConfig,
    MemberKey, MultisigError, Permission, ProofArgs, Secp256r1VerifyArgsWithDomainAddress,
    SettingsReadonlyArgs, TransactionActionType, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::{hash::hash, sysvar::SysvarId},
    system_program::{transfer, Transfer},
};

#[derive(Accounts)]
pub struct NativeTransferIntentCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
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
        remaining_accounts: &'info [AccountInfo<'info>],
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings: &CompressedSettingsData,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            system_program,
            destination,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;

        let threshold = settings.threshold as usize;
        let secp256r1_member_keys: Vec<(MemberKey, &Secp256r1VerifyArgsWithDomainAddress)> =
            secp256r1_verify_args
                .iter()
                .filter_map(|arg| {
                    let pubkey = arg
                        .verify_args
                        .extract_public_key_from_instruction(Some(&self.instructions_sysvar))
                        .ok()?;

                    let member_key = MemberKey::convert_secp256r1(&pubkey).ok()?;

                    Some((member_key, arg))
                })
                .collect();

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);

            let secp256r1_signer = secp256r1_member_keys
                .iter()
                .find(|f| f.0.eq(&member.pubkey));
            let is_signer = secp256r1_signer.is_some()
                || remaining_accounts.iter().any(|account| {
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
                let account_loader = DomainConfig::extract_domain_config_account(
                    remaining_accounts,
                    secp256r1_verify_data.domain_config_key,
                )?;

                let mut buffer = vec![];
                buffer.extend_from_slice(amount.to_le_bytes().as_ref());
                buffer.extend_from_slice(destination.key().as_ref());
                buffer.extend_from_slice(system_program.key().as_ref());
                let message_hash = hash(&buffer).to_bytes();

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: system_program.key(),
                        message_hash,
                        action_type: TransactionActionType::TransferIntent,
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
        ctx: Context<'_, '_, 'info, 'info, Self>,
        amount: u64,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_readonly: SettingsReadonlyArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let (settings, settings_key) = CompressedSettings::verify_compressed_settings(
            &ctx.accounts.payer.to_account_info(),
            &settings_readonly,
            ctx.remaining_accounts,
            &compressed_proof_args,
        )?;

        ctx.accounts.validate(
            amount,
            ctx.remaining_accounts,
            &secp256r1_verify_args,
            &settings,
        )?;

        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

        let multi_wallet = Pubkey::create_program_address(signer_seeds, &crate::id())
            .map_err(ProgramError::from)?;
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

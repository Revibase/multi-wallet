use crate::{
    durable_nonce_check, state::SettingsReadonlyArgs, ChallengeArgs, CompressedSettings,
    CompressedSettingsData, DomainConfig, MemberKey, MultisigError, Permission, ProofArgs,
    Secp256r1VerifyArgsWithDomainAddress, TransactionActionType, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, program_pack::Pack, sysvar::SysvarId},
};
use light_sdk::light_hasher::{Hasher, Sha256};
use spl_associated_token_account::instruction::create_associated_token_account_idempotent;
use spl_token_2022::state::Mint;

#[derive(Accounts)]
pub struct TokenTransferIntentCompressed<'info> {
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
    /// CHECK: checked in instructions
    #[account(mut)]
    pub source: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,
        seeds = [
            &source.key().to_bytes(),
            &token_program.key().to_bytes(),
            &mint.key().to_bytes(),
        ],
        bump,
        seeds::program = spl_associated_token_account::id()
    )]
    pub source_token_account: UncheckedAccount<'info>,
    /// CHECK:
    pub destination: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,
        seeds = [
            &destination.key().to_bytes(),
            &token_program.key().to_bytes(),
            &mint.key().to_bytes(),
        ],
        bump,
        seeds::program = spl_associated_token_account::id()
    )]
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK:
    pub token_program: UncheckedAccount<'info>,
    /// CHECK:
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = spl_associated_token_account::id()
    )]
    pub associated_token_program: UncheckedAccount<'info>,
}

impl<'info> TokenTransferIntentCompressed<'info> {
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
            mint,
            destination,
            token_program,
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
                buffer.extend_from_slice(mint.key().as_ref());
                let message_hash = Sha256::hash(&buffer).unwrap();

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: token_program.key(),
                        message_hash,
                        action_type: TransactionActionType::TransferIntent,
                    },
                    None,
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
        create_ata_if_needed: bool,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_readonly_args: SettingsReadonlyArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let (settings, settings_key) = CompressedSettings::verify_compressed_settings_account(
            &ctx.accounts.payer.to_account_info(),
            &settings_readonly_args,
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

        if create_ata_if_needed {
            let ata_ix = create_associated_token_account_idempotent(
                ctx.accounts.source.key,
                ctx.accounts.destination.key,
                ctx.accounts.mint.key,
                ctx.accounts.token_program.key,
            );

            invoke_signed(
                &ata_ix,
                &[
                    ctx.accounts.source.to_account_info(),
                    ctx.accounts.destination_token_account.to_account_info(),
                    ctx.accounts.destination.to_account_info(),
                    ctx.accounts.mint.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.associated_token_program.to_account_info(),
                ],
                &[signer_seeds],
            )?;
        }

        let mint = Mint::unpack(&mut ctx.accounts.mint.data.borrow_mut().as_ref())?;

        let ix = spl_token_2022::instruction::transfer_checked(
            ctx.accounts.token_program.key,
            ctx.accounts.source_token_account.key,
            ctx.accounts.mint.key,
            ctx.accounts.destination_token_account.key,
            ctx.accounts.source.key,
            &[],
            amount,
            mint.decimals,
        )?;
        invoke_signed(
            &ix,
            &[
                ctx.accounts.source_token_account.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.destination_token_account.to_account_info(),
                ctx.accounts.source.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        Ok(())
    }
}

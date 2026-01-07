use crate::{
    durable_nonce_check, ChallengeArgs, DomainConfig, MemberKey, MultisigError, Permission,
    Secp256r1VerifyArgsWithDomainAddress, Settings, TransactionActionType, SEED_MULTISIG,
    SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::SysvarId,
    system_program::{transfer, Transfer},
};
use light_sdk::light_hasher::{Hasher, Sha256};

#[derive(Accounts)]
pub struct NativeTransferIntent<'info> {
    #[account(mut)]
    pub settings: AccountLoader<'info, Settings>,
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

    /// CHECK:
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_VAULT,
        ],
        bump = settings.load()?.multi_wallet_bump,
    )]
    pub source: UncheckedAccount<'info>,

    /// CHECK:
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> NativeTransferIntent<'info> {
    fn validate(
        &self,
        amount: u64,
        remaining_accounts: &'info [AccountInfo<'info>],
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            system_program,
            destination,
            settings,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;
        let mut are_delegates = true;

        let settings_data = settings.load()?;
        let threshold = settings_data.threshold as usize;
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

        for member in &settings_data.members {
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
                if secp256r1_signer.is_some() && member.is_delegate == 0 {
                    are_delegates = false;
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
                let message_hash = Sha256::hash(&buffer).unwrap();

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: system_program.key(),
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
        require!(are_delegates, MultisigError::InvalidNonDelegatedSigners);

        Ok(())
    }

    #[access_control(ctx.accounts.validate(amount, &ctx.remaining_accounts, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        amount: u64,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings.load_mut()?;
        let settings_key = ctx.accounts.settings.key();
        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ];

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

        settings.latest_slot_number_check(
            secp256r1_verify_args
                .iter()
                .map(|f| f.verify_args.slot_number)
                .collect(),
            &ctx.accounts.slot_hash_sysvar,
        )?;

        settings.invariant()?;

        Ok(())
    }
}

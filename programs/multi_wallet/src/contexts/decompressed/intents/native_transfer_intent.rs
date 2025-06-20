use crate::{
    state::{
        DomainConfig, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType, SEED_MULTISIG,
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
pub struct NativeTransferIntent<'info> {
    pub settings: Account<'info, Settings>,
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

    /// CHECK:
    #[account(
        mut,
        seeds = [
            SEED_MULTISIG,
            settings.key().as_ref(),
            SEED_VAULT,
        ],
        bump = settings.multi_wallet_bump,
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
        ctx: &Context<'_, '_, '_, 'info, Self>,
        amount: u64,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let Self {
            settings,
            domain_config,
            slot_hash_sysvar,
            destination,
            system_program,
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

                let mut buffer = vec![];
                buffer.extend_from_slice(amount.to_le_bytes().as_ref());
                buffer.extend_from_slice(destination.key().as_ref());
                buffer.extend_from_slice(system_program.key().as_ref());
                let message_hash = hash(&buffer).to_bytes();

                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                Secp256r1Pubkey::verify_webauthn(
                    secp256r1_verify_data,
                    &slot_hash_sysvar,
                    &domain_config,
                    &system_program.key(),
                    &message_hash,
                    TransactionActionType::NativeTransferIntent,
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

    #[access_control(ctx.accounts.validate(&ctx, amount, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        amount: u64,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let settings = &mut ctx.accounts.settings;
        let settings_key = settings.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings.multi_wallet_bump],
        ]];

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            amount,
        )?;

        Ok(())
    }
}

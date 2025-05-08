use crate::{
    state::{
        DomainConfig, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType, SEED_MULTISIG,
    },
    MultisigError, Permission, SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::{hash::hash, sysvar::SysvarId},
    system_program::{transfer, Transfer},
};

#[derive(Accounts)]
pub struct NativeTransferIntent<'info> {
    pub settings: Box<Account<'info, Settings>>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: UncheckedAccount<'info>,

    pub domain_config: AccountLoader<'info, DomainConfig>,

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
        secp256r1_verify_args: &Secp256r1VerifyArgs,
    ) -> Result<()> {
        let Self {
            settings,
            domain_config,
            slot_hash_sysvar,
            destination,
            system_program,
            ..
        } = self;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;
        let threshold = settings.threshold as usize;

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);
            let is_signer = member
                .pubkey
                .eq(&MemberKey::convert_secp256r1(&secp256r1_verify_args.pubkey).unwrap())
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

        let member = settings
            .members
            .iter()
            .find(|x| {
                x.pubkey
                    .eq(&MemberKey::convert_secp256r1(&secp256r1_verify_args.pubkey).unwrap())
            })
            .ok_or(MultisigError::MissingAccount)?;

        let expected_domain_config = member
            .domain_config
            .ok_or(MultisigError::DomainConfigIsMissing)?;

        require!(
            domain_config.key().eq(&expected_domain_config),
            MultisigError::MemberDoesNotBelongToDomainConfig
        );

        let message_hash = hash(
            [
                amount.to_le_bytes().as_ref(),
                destination.key().as_ref(),
                Pubkey::default().as_ref(),
            ]
            .concat()
            .as_ref(),
        )
        .to_bytes();

        Secp256r1Pubkey::verify_webauthn(
            &secp256r1_verify_args,
            &Some(slot_hash_sysvar.to_owned()),
            &Some(domain_config.to_owned()),
            &system_program.key(),
            &message_hash,
            TransactionActionType::NativeTransferIntent,
        )?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, amount, &secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        amount: u64,
        secp256r1_verify_args: Secp256r1VerifyArgs,
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

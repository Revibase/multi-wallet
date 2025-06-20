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
    solana_program::{hash::hash, program::invoke_signed, sysvar::SysvarId},
};
use anchor_spl::{
    associated_token::{
        spl_associated_token_account::instruction::create_associated_token_account_idempotent,
        AssociatedToken,
    },
    token::Token,
    token_2022::Token2022,
    token_interface::{transfer_checked, Mint, TransferChecked},
};

#[derive(Accounts)]
pub struct TokenTransferIntent<'info> {
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
    #[account(
        mut,
        seeds = [
            &source.key().to_bytes(),
            &token_program.key().to_bytes(),
            &mint.key().to_bytes(),
        ],
        bump,
        seeds::program = AssociatedToken::id()
    )]
    pub source_token_account: UncheckedAccount<'info>,
    /// CHECK:
    pub destination: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        constraint = (token_program.key() == Token::id() || token_program.key() == Token2022::id())
    )]
    pub token_program: UncheckedAccount<'info>,
    /// CHECK:
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> TokenTransferIntent<'info> {
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
            mint,
            token_program,
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
                buffer.extend_from_slice(mint.key().as_ref());
                let message_hash = hash(&buffer).to_bytes();

                let secp256r1_verify_data = secp256r1_verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                Secp256r1Pubkey::verify_webauthn(
                    secp256r1_verify_data,
                    &slot_hash_sysvar,
                    &domain_config,
                    &token_program.key(),
                    &message_hash,
                    TransactionActionType::TokenTransferIntent,
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

        let ata_ix = create_associated_token_account_idempotent(
            ctx.accounts.source.key,
            ctx.accounts.destination.key,
            &ctx.accounts.mint.key(),
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
            signer_seeds,
        )?;

        let mint = Mint::try_deserialize(&mut ctx.accounts.mint.data.borrow_mut().as_ref())?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination_token_account.to_account_info(),
                    authority: ctx.accounts.source.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            amount,
            mint.decimals,
        )?;

        Ok(())
    }
}

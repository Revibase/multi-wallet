use crate::{
    state::{
        ChallengeArgs, DomainConfig, KeyType, MemberKey, Secp256r1VerifyArgs, Settings,
        TransactionActionType,
    },
    MultisigError, Permission, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferExecute<'info> {
    #[account(
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: AccountLoader<'info, Settings>,
    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,
    pub executor: Option<Signer<'info>>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
}

impl<'info> TransactionBufferExecute<'info> {
    fn validate(&self, secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Result<()> {
        let Self {
            settings,
            transaction_buffer,
            executor,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        transaction_buffer.validate_hash()?;
        transaction_buffer.validate_size()?;
        let settings = settings.load()?;
        if transaction_buffer.permissionless_execution {
            let vote_count = settings
                .members
                .iter()
                .filter(|x| {
                    x.permissions.has(Permission::VoteTransaction)
                        && (transaction_buffer.voters.contains(&x.pubkey))
                })
                .count();

            require!(
                vote_count >= settings.threshold as usize,
                MultisigError::InsufficientSignersWithVotePermission
            );
            return Ok(());
        }

        let signer = MemberKey::get_signer(
            executor,
            secp256r1_verify_args,
            instructions_sysvar.as_ref(),
        )?;

        let member = settings
            .members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        require!(
            member.permissions.has(Permission::ExecuteTransaction),
            MultisigError::InsufficientSignerWithExecutePermission
        );

        let vote_count = settings
            .members
            .iter()
            .filter(|x| {
                x.permissions.has(Permission::VoteTransaction)
                    && (transaction_buffer.voters.contains(&x.pubkey) || signer.eq(&x.pubkey))
            })
            .count();

        require!(
            vote_count >= settings.threshold as usize,
            MultisigError::InsufficientSignersWithVotePermission
        );

        if signer.get_type().eq(&KeyType::Secp256r1) {
            require!(
                member.domain_config.ne(&Pubkey::default()),
                MultisigError::DomainConfigIsMissing
            );

            require!(
                domain_config.is_some()
                    && domain_config
                        .as_ref()
                        .unwrap()
                        .key()
                        .eq(&member.domain_config),
                MultisigError::MemberDoesNotBelongToDomainConfig
            );

            let secp256r1_verify_data = secp256r1_verify_args
                .as_ref()
                .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

            let instructions_sysvar = instructions_sysvar
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;

            secp256r1_verify_data.verify_webauthn(
                slot_hash_sysvar,
                domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: transaction_buffer.key(),
                    message_hash: transaction_buffer.final_buffer_hash,
                    action_type: TransactionActionType::Execute,
                },
            )?;
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        ctx.accounts.transaction_buffer.can_execute = true;
        Ok(())
    }
}

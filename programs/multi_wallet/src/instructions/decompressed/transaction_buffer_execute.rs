use crate::{
    utils::MultisigSettings, ChallengeArgs, DomainConfig, KeyType, MemberKey, MultisigError,
    Permission, Secp256r1VerifyArgs, Settings, TransactionActionType, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(Accounts)]
pub struct TransactionBufferExecute<'info> {
    #[account(
        mut,
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: Account<'info, Settings>,
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
    fn validate(&mut self, secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Result<()> {
        let Self {
            settings,
            transaction_buffer,
            executor,
            domain_config,
            slot_hash_sysvar,
            instructions_sysvar,
            ..
        } = self;

        require!(
            Clock::get()?.unix_timestamp as u64 <= transaction_buffer.valid_till,
            MultisigError::TransactionHasExpired
        );
        transaction_buffer.validate_hash()?;
        transaction_buffer.validate_size()?;
        let members = settings.get_members()?;
        if transaction_buffer.preauthorize_execution {
            let vote_count = members
                .iter()
                .filter(|x| {
                    x.permissions.has(Permission::VoteTransaction)
                        && (transaction_buffer.voters.contains(&x.pubkey))
                })
                .count();

            require!(
                vote_count >= settings.get_threshold()? as usize,
                MultisigError::InsufficientSignersWithVotePermission
            );
            return Ok(());
        }

        let signer = MemberKey::get_signer(
            executor,
            secp256r1_verify_args,
            instructions_sysvar.as_ref(),
        )?;

        let member = members
            .iter()
            .find(|x| x.pubkey.eq(&signer))
            .ok_or(MultisigError::MissingAccount)?;

        require!(
            member.permissions.has(Permission::ExecuteTransaction),
            MultisigError::InsufficientSignerWithExecutePermission
        );

        let vote_count = members
            .iter()
            .filter(|x| {
                x.permissions.has(Permission::VoteTransaction)
                    && (transaction_buffer.voters.contains(&x.pubkey) || signer.eq(&x.pubkey))
            })
            .count();

        require!(
            vote_count >= settings.get_threshold()? as usize,
            MultisigError::InsufficientSignersWithVotePermission
        );

        if signer.get_type().eq(&KeyType::Secp256r1) {
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
                    account: transaction_buffer.multi_wallet_settings,
                    message_hash: transaction_buffer.final_buffer_hash,
                    action_type: TransactionActionType::Execute,
                },
                &transaction_buffer.expected_secp256r1_signers,
            )?;
            settings
                .latest_slot_number_check(&[secp256r1_verify_data.slot_number], slot_hash_sysvar)?;
        }
        settings.invariant()?;

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&secp256r1_verify_args))]
    pub fn process(
        ctx: Context<'_, '_, '_, 'info, Self>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        if !transaction_buffer.preauthorize_execution {
            let signer = MemberKey::get_signer(
                &ctx.accounts.executor,
                &secp256r1_verify_args,
                ctx.accounts.instructions_sysvar.as_ref(),
            )?;
            ctx.accounts.transaction_buffer.add_executor(signer)?;
        }

        ctx.accounts.transaction_buffer.can_execute = true;
        Ok(())
    }
}

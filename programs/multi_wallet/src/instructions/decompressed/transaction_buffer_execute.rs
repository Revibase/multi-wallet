use crate::{
    utils::{MultisigSettings, TransactionBufferSigners},
    DomainConfig, MemberKey, MultisigError, Secp256r1VerifyArgs, Settings, TransactionBuffer,
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

        let members = settings.get_members()?;
        if transaction_buffer.preauthorize_execution {
            let vote_count = members
                .iter()
                .filter(|x| {
                    x.permissions.has(crate::Permission::VoteTransaction)
                        && (transaction_buffer.voters.contains(&x.pubkey))
                })
                .count();

            require!(
                vote_count >= settings.get_threshold()? as usize,
                MultisigError::InsufficientSignersWithVotePermission
            );
            return Ok(());
        }

        TransactionBufferSigners::verify_execute(
            executor,
            secp256r1_verify_args,
            instructions_sysvar,
            slot_hash_sysvar,
            domain_config,
            members,
            settings.get_threshold()?,
            transaction_buffer.multi_wallet_settings,
            transaction_buffer.final_buffer_hash,
            transaction_buffer.voters.as_ref(),
            &transaction_buffer.expected_signers,
        )?;

        let slot_numbers = TransactionBufferSigners::collect_slot_numbers(&secp256r1_verify_args);
        settings.latest_slot_number_check(&slot_numbers, &slot_hash_sysvar)?;
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

        ctx.accounts.transaction_buffer.execute()?;
        Ok(())
    }
}

use crate::{
    state::{
        DomainConfig, KeyType, MemberKey, Secp256r1Pubkey, Secp256r1VerifyArgs, Settings,
        TransactionActionType,
    },
    MultisigError, TransactionBuffer,
};
use anchor_lang::{prelude::*, solana_program::sysvar::SysvarId};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TransactionBufferExtendArgs {
    // Buffer to extend the TransactionBuffer with.
    pub buffer: Vec<u8>,
}

#[derive(Accounts)]
pub struct TransactionBufferExtend<'info> {
    #[account(
        address = transaction_buffer.multi_wallet_settings,
    )]
    pub settings: Option<Account<'info, Settings>>,
    #[account(mut)]
    pub transaction_buffer: Account<'info, TransactionBuffer>,

    pub domain_config: Option<AccountLoader<'info, DomainConfig>>,

    pub creator: Option<Signer<'info>>,

    /// CHECK:
    #[account(
        address = SlotHashes::id(),
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
}

impl TransactionBufferExtend<'_> {
    fn validate(
        &self,
        args: &TransactionBufferExtendArgs,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        let Self {
            settings,
            creator,
            transaction_buffer,
            domain_config,
            slot_hash_sysvar,
            ..
        } = self;

        // Extended Buffer size must not exceed final buffer size
        // Calculate remaining space in the buffer
        let current_buffer_size = transaction_buffer.buffer.len() as u16;
        let remaining_space = transaction_buffer
            .final_buffer_size
            .checked_sub(current_buffer_size)
            .unwrap();

        // Check if the new data exceeds the remaining space
        let new_data_size = args.buffer.len() as u16;
        require!(
            new_data_size <= remaining_space,
            MultisigError::FinalBufferSizeExceeded
        );

        let signer = MemberKey::get_signer(&creator, secp256r1_verify_args)?;

        require!(
            transaction_buffer.creator.eq(&signer),
            MultisigError::UnauthorisedToModifyBuffer
        );

        if signer.get_type().eq(&KeyType::Secp256r1) {
            let settings_members = &settings
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?
                .members;

            let member = settings_members
                .iter()
                .find(|x| x.pubkey.eq(&signer))
                .ok_or(MultisigError::MissingAccount)?;

            let metadata = member.metadata.ok_or(MultisigError::MissingMetadata)?;

            require!(
                domain_config.is_some() && domain_config.as_ref().unwrap().key().eq(&metadata),
                MultisigError::MemberDoesNotBelongToDomainConfig
            );
            Secp256r1Pubkey::verify_secp256r1(
                secp256r1_verify_args,
                slot_hash_sysvar,
                domain_config,
                &transaction_buffer.key(),
                &transaction_buffer.final_buffer_hash,
                TransactionActionType::Create,
            )?;
        }

        Ok(())
    }

    /// Create a new vault transaction.
    #[access_control(ctx.accounts.validate(&args,&secp256r1_verify_args))]
    pub fn process(
        ctx: Context<Self>,
        args: TransactionBufferExtendArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        // Mutable Accounts
        let transaction_buffer = &mut ctx.accounts.transaction_buffer;

        // Extend the Buffer inside the TransactionBuffer
        transaction_buffer.buffer.extend_from_slice(&args.buffer);

        // Invariant function on the transaction buffer
        transaction_buffer.invariant()?;

        Ok(())
    }
}

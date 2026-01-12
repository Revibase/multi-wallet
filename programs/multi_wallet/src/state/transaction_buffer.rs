use crate::{
    utils::{ExpectedSecp256r1Signers, KeyType},
    MemberKey, MultisigError,
};
use anchor_lang::prelude::*;
use light_sdk::light_hasher::{Hasher, Sha256};

// Maximum PDA allocation size in an inner ix is 10240 bytes.
// 10240 - account contents = 10128 bytes
pub const MAX_BUFFER_SIZE: usize = 10128;

// Maximum amount of time a transaction is considered valid for execution
// 3mins
pub const TRANSACTION_TIME_LIMIT: u64 = 3 * 60;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct TransactionBufferCreateArgs {
    pub buffer_index: u8,
    pub preauthorize_execution: bool,
    pub buffer_extend_hashes: Vec<[u8; 32]>,
    pub final_buffer_hash: [u8; 32],
    pub final_buffer_size: u16,
    pub expected_secp256r1_signers: Vec<ExpectedSecp256r1Signers>,
}

#[account]
pub struct TransactionBuffer {
    /// The multisig settings this belongs to.
    pub multi_wallet_settings: Pubkey,
    /// The bump for the multi_wallet
    pub multi_wallet_bump: u8,
    /// Flag to allow transaction to be executed
    pub can_execute: bool,
    /// Flag to preauthorize execution before sufficient threshold is met
    pub preauthorize_execution: bool,
    // Transaction valid till
    pub valid_till: u64,
    /// Payer for the transaction buffer
    pub payer: Pubkey,
    /// transaction bump
    pub bump: u8,
    /// Index to seed address derivation
    pub buffer_index: u8,
    /// Hash of the final assembled transaction message.
    pub final_buffer_hash: [u8; 32],
    /// The size of the final assembled transaction message.
    pub final_buffer_size: u16,
    /// Member of the Multisig who created the TransactionBuffer.
    pub creator: MemberKey,
    /// Member of the Multisig who executed the TransactionBuffer.
    pub executor: MemberKey,
    /// Buffer hash for all the buffer extend instruction
    pub buffer_extend_hashes: Vec<[u8; 32]>,
    /// Members that voted for this transaction
    pub voters: Vec<MemberKey>,
    /// All Secp256r1 Signers that are expected to initiate / vote / execute this transaction (used for off-chain inspection by the transaction manager)
    pub expected_secp256r1_signers: Vec<ExpectedSecp256r1Signers>,
    /// The buffer of the transaction message.
    pub buffer: Vec<u8>,
}

impl TransactionBuffer {
    pub fn init(
        &mut self,
        settings_key: Pubkey,
        multi_wallet_bump: u8,
        payer: Pubkey,
        args: &TransactionBufferCreateArgs,
        bump: u8,
    ) -> Result<()> {
        self.multi_wallet_settings = settings_key;
        self.multi_wallet_bump = multi_wallet_bump;
        self.can_execute = false;
        self.preauthorize_execution = args.preauthorize_execution;
        self.buffer_extend_hashes = args.buffer_extend_hashes.to_vec();
        self.payer = payer;
        self.buffer_index = args.buffer_index;
        self.final_buffer_hash = args.final_buffer_hash;
        self.final_buffer_size = args.final_buffer_size;
        self.buffer = Vec::new();
        self.bump = bump;
        self.valid_till = Clock::get().unwrap().unix_timestamp as u64 + TRANSACTION_TIME_LIMIT;
        self.voters = Vec::new();
        self.expected_secp256r1_signers = args.expected_secp256r1_signers.clone();
        Ok(())
    }

    pub fn size(
        final_message_buffer_size: u16,
        number_of_extend_buffers: usize,
        number_of_voters: usize,
        number_of_expected_secp256r1_signers: usize,
    ) -> Result<usize> {
        // Make sure final size is not greater than MAX_BUFFER_SIZE bytes.
        if (final_message_buffer_size as usize) > MAX_BUFFER_SIZE {
            return err!(MultisigError::FinalBufferSizeExceeded);
        }
        Ok(
            8  +  // anchor account discriminator
            32 +  // multisig
            1  +  // multi_wallet_bump
            1  +  // can execute
            1  +  // preauthorize_execution
            8  +  // transaction expiry
            32 +  // rent_payer
            1  +  // bump
            1  +  // buffer_index
            32 +  // final_buffer_hash
            2  +  // final_buffer_size
            2 * MemberKey::INIT_SPACE +  // creator & executor
            (4 + number_of_extend_buffers * 32 ) + // extend buffer hash
            (4 + number_of_voters * MemberKey::INIT_SPACE)  +  // maximum number of members 
            (4 + number_of_expected_secp256r1_signers * ExpectedSecp256r1Signers::INIT_SPACE)  +  // maximum number of expected secp256r1 members 
            (4 + usize::from(final_message_buffer_size)), // buffer
        )
    }

    pub fn validate_hash(&self) -> Result<()> {
        let message_buffer_hash = Sha256::hash(&self.buffer).unwrap();
        require!(
            message_buffer_hash == self.final_buffer_hash,
            MultisigError::FinalBufferHashMismatch
        );
        Ok(())
    }
    pub fn validate_size(&self) -> Result<()> {
        require_eq!(
            self.buffer.len(),
            self.final_buffer_size as usize,
            MultisigError::FinalBufferSizeMismatch
        );
        Ok(())
    }

    pub fn invariant(&self) -> Result<()> {
        require!(
            self.final_buffer_size as usize <= MAX_BUFFER_SIZE,
            MultisigError::FinalBufferSizeExceeded
        );
        require!(
            self.buffer.len() <= MAX_BUFFER_SIZE,
            MultisigError::FinalBufferSizeExceeded
        );
        require!(
            self.buffer.len() <= self.final_buffer_size as usize,
            MultisigError::FinalBufferSizeMismatch
        );

        Ok(())
    }

    pub fn add_voter(&mut self, voter: &MemberKey) -> Result<()> {
        if !self.voters.contains(voter) {
            require!(
                voter.get_type().ne(&KeyType::Secp256r1)
                    || self
                        .expected_secp256r1_signers
                        .iter()
                        .any(|f| f.member_key.eq(&voter)),
                MultisigError::UnexpectedSigner
            );

            self.voters.push(*voter);
        }
        Ok(())
    }

    pub fn add_initiator(&mut self, creator: MemberKey) -> Result<()> {
        require!(
            creator.get_type().ne(&KeyType::Secp256r1)
                || self
                    .expected_secp256r1_signers
                    .iter()
                    .any(|f| f.member_key.eq(&creator)),
            MultisigError::UnexpectedSigner
        );

        self.creator = creator;
        Ok(())
    }

    pub fn add_executor(&mut self, executor: MemberKey) -> Result<()> {
        require!(
            executor.get_type().ne(&KeyType::Secp256r1)
                || self
                    .expected_secp256r1_signers
                    .iter()
                    .any(|f| f.member_key.eq(&executor)),
            MultisigError::UnexpectedSigner
        );

        self.executor = executor;
        Ok(())
    }
}

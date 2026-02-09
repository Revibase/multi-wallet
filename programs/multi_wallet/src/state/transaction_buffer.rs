use crate::{MemberKey, MultisigError};
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
    pub expected_signers: Vec<ExpectedSigner>,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, InitSpace)]
pub struct ExpectedSigner {
    pub member_key: MemberKey,
    pub message_hash: Option<[u8; 32]>,
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
    /// All Signers that are expected to initiate / vote / execute this transaction (used for off-chain inspection by the transaction manager)
    pub expected_signers: Vec<ExpectedSigner>,
    /// The buffer of the transaction message.
    pub buffer: Vec<u8>,
}

impl TransactionBuffer {
    pub fn init(
        &mut self,
        settings_key: Pubkey,
        multi_wallet_bump: u8,
        payer: Pubkey,
        args: TransactionBufferCreateArgs,
        bump: u8,
    ) -> Result<()> {
        self.multi_wallet_settings = settings_key;
        self.multi_wallet_bump = multi_wallet_bump;
        self.can_execute = false;
        self.preauthorize_execution = args.preauthorize_execution;
        self.buffer_extend_hashes = args.buffer_extend_hashes;
        self.payer = payer;
        self.buffer_index = args.buffer_index;
        self.final_buffer_hash = args.final_buffer_hash;
        self.final_buffer_size = args.final_buffer_size;
        self.buffer = Vec::new();
        self.bump = bump;
        self.valid_till = Clock::get()?
            .unix_timestamp
            .checked_add(TRANSACTION_TIME_LIMIT as i64)
            .and_then(|ts| u64::try_from(ts).ok())
            .ok_or(MultisigError::InvalidArguments)?;
        self.voters = Vec::new();
        self.expected_signers = args.expected_signers;
        Ok(())
    }

    pub fn size(
        final_message_buffer_size: u16,
        number_of_extend_buffers: usize,
        number_of_expected_signers: usize,
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
            (4 + number_of_expected_signers * MemberKey::INIT_SPACE)  +  // maximum number of voters 
            (4 + number_of_expected_signers * ExpectedSigner::INIT_SPACE)  +  // maximum number of expected signers 
            (4 + usize::from(final_message_buffer_size)), // buffer
        )
    }

    pub fn execute(&mut self) -> Result<()> {
        self.validate_hash()?;
        self.validate_size()?;
        require!(
            Clock::get()?.unix_timestamp as u64 <= self.valid_till,
            MultisigError::TransactionHasExpired
        );
        require!(
            self.expected_signers
                .iter()
                .all(|f| self.creator.eq(&f.member_key)
                    || self.executor.eq(&f.member_key)
                    || self.voters.contains(&f.member_key)),
            MultisigError::UnexpectedSigner
        );

        self.can_execute = true;
        Ok(())
    }

    pub fn validate_hash(&self) -> Result<()> {
        let message_buffer_hash =
            Sha256::hash(&self.buffer).map_err(|_| MultisigError::HashComputationFailed)?;
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
            self.voters.push(*voter);
        }
        Ok(())
    }

    pub fn add_initiator(&mut self, creator: MemberKey) -> Result<()> {
        self.creator = creator;
        Ok(())
    }

    pub fn add_executor(&mut self, executor: MemberKey) -> Result<()> {
        self.executor = executor;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transaction_buffer_size_exceeds_max() {
        let result = TransactionBuffer::size(MAX_BUFFER_SIZE as u16 + 1, 0, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_transaction_buffer_size_at_max() {
        let result = TransactionBuffer::size(MAX_BUFFER_SIZE as u16, 0, 0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_transaction_buffer_size_with_voters() {
        let size_no_voters = TransactionBuffer::size(100, 0, 0).unwrap();
        let size_with_voters = TransactionBuffer::size(100, 0, 4).unwrap();
        assert!(size_with_voters > size_no_voters);
    }

    #[test]
    fn test_transaction_buffer_size_with_extend_buffers() {
        let size_no_extend = TransactionBuffer::size(100, 0, 0).unwrap();
        let size_with_extend = TransactionBuffer::size(100, 3, 0).unwrap();
        assert!(size_with_extend > size_no_extend);
        assert_eq!(size_with_extend - size_no_extend, 3 * 32);
    }

    #[test]
    fn test_transaction_buffer_size_with_expected_signers() {
        // Size should increase with number_of_expected_signers (affects both voters and expected_signers capacity)
        let size_0 = TransactionBuffer::size(100, 0, 0).unwrap();
        let size_1 = TransactionBuffer::size(100, 0, 1).unwrap();
        let size_2 = TransactionBuffer::size(100, 0, 2).unwrap();
        assert!(size_1 > size_0);
        assert!(size_2 > size_1);
        let expected_increment_per_signer =
            MemberKey::INIT_SPACE + ExpectedSigner::INIT_SPACE;
        assert_eq!(size_1 - size_0, expected_increment_per_signer);
        assert_eq!(size_2 - size_1, expected_increment_per_signer);
    }

    #[test]
    fn test_transaction_buffer_validate_size_empty() {
        let buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 0,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![],
        };
        assert!(buffer.validate_size().is_ok());
    }

    #[test]
    fn test_transaction_buffer_validate_size_mismatch() {
        let buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 100,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![1, 2, 3],
        };
        assert!(buffer.validate_size().is_err());
    }

    #[test]
    fn test_transaction_buffer_invariant_valid() {
        let buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 100,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![0u8; 50],
        };
        assert!(buffer.invariant().is_ok());
    }

    #[test]
    fn test_transaction_buffer_invariant_buffer_exceeds_final_size() {
        let buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 10,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![0u8; 50],
        };
        assert!(buffer.invariant().is_err());
    }

    #[test]
    fn test_add_voter_ed25519() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        let mut buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 0,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![],
        };
        assert!(buffer.add_voter(&member_key).is_ok());
        assert_eq!(buffer.voters.len(), 1);
        assert_eq!(buffer.voters[0], member_key);
    }

    #[test]
    fn test_add_voter_duplicate_ignored() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        let mut buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 0,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![],
        };
        buffer.add_voter(&member_key).unwrap();
        buffer.add_voter(&member_key).unwrap();
        assert_eq!(buffer.voters.len(), 1);
    }

    #[test]
    fn test_add_initiator_ed25519() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        let mut buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 0,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![],
        };
        assert!(buffer.add_initiator(member_key).is_ok());
        assert_eq!(buffer.creator, member_key);
    }

    #[test]
    fn test_add_executor_ed25519() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        let mut buffer = TransactionBuffer {
            multi_wallet_settings: Pubkey::new_unique(),
            multi_wallet_bump: 0,
            can_execute: false,
            preauthorize_execution: false,
            valid_till: 0,
            payer: Pubkey::new_unique(),
            bump: 0,
            buffer_index: 0,
            final_buffer_hash: [0u8; 32],
            final_buffer_size: 0,
            creator: MemberKey::default(),
            executor: MemberKey::default(),
            buffer_extend_hashes: vec![],
            voters: vec![],
            expected_signers: vec![],
            buffer: vec![],
        };
        assert!(buffer.add_executor(member_key).is_ok());
        assert_eq!(buffer.executor, member_key);
    }
}

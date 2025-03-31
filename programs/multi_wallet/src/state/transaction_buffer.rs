use crate::MultisigError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

use crate::state::member::MemberKey;

// Maximum PDA allocation size in an inner ix is 10240 bytes.
// 10240 - account contents = 10128 bytes
pub const MAX_BUFFER_SIZE: usize = 10128;

#[account]
pub struct TransactionBuffer {
    /// The multisig settings this belongs to.
    pub multi_wallet_settings: Pubkey,
    /// Member of the Multisig who created the TransactionBuffer.
    pub creator: MemberKey,
    /// Members that voted for this transaction
    pub voters: Vec<MemberKey>,
    // Transaction valid till
    pub expiry: u64,
    /// Rent payer for the transaction buffer
    pub rent_payer: Pubkey,
    /// transaction bump
    pub bump: u8,
    /// Index to seed address derivation
    pub buffer_index: u8,
    /// Hash of the final assembled transaction message.
    pub final_buffer_hash: [u8; 32],
    /// The size of the final assembled transaction message.
    pub final_buffer_size: u16,
    /// The buffer of the transaction message.
    pub buffer: Vec<u8>,
}

#[derive(Clone, Copy)]
pub enum TransactionBufferActionType {
    Create,
    Execute,
    Close,
    Vote,
}

impl TransactionBufferActionType {
    pub fn to_bytes(&self) -> &[u8] {
        match &self {
            TransactionBufferActionType::Create => b"create",
            TransactionBufferActionType::Execute => b"execute",
            TransactionBufferActionType::Close => b"close",
            TransactionBufferActionType::Vote => b"vote",
        }
    }
}

impl TransactionBuffer {
    pub fn size(number_of_voters: u8, final_message_buffer_size: u16) -> Result<usize> {
        // Make sure final size is not greater than MAX_BUFFER_SIZE bytes.
        if (final_message_buffer_size as usize) > MAX_BUFFER_SIZE {
            return err!(MultisigError::FinalBufferSizeExceeded);
        }
        Ok(
            8  +  // anchor account discriminator
            32 +  // multisig
            MemberKey::INIT_SPACE +  // creator
            (4 + usize::from(number_of_voters) * MemberKey::INIT_SPACE)  +  // number of signers 
            8  +  // transaction expiry
            32 +  // rent_payer
            1  +  // bump
            1  +  // buffer_index
            32 +  // final_buffer_hash
            2  +  // final_buffer_size
            (4 + usize::from(final_message_buffer_size)), // buffer
        )
    }

    pub fn validate_hash(&self) -> Result<()> {
        let message_buffer_hash = hash(&self.buffer);
        require!(
            message_buffer_hash.to_bytes() == self.final_buffer_hash,
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
        let mut seen = std::collections::HashSet::new();
        for member in &self.voters {
            if !seen.insert(member) {
                return Err(MultisigError::DuplicateMember.into());
            }
        }

        Ok(())
    }

    pub fn add_voter(&mut self, voter: MemberKey) {
        if !self.voters.contains(&voter) {
            self.voters.push(voter);
        }
    }
}

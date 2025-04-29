use crate::contexts::TransactionBufferCreateArgs;
use crate::MultisigError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

use super::{MemberKey, Settings};

// Maximum PDA allocation size in an inner ix is 10240 bytes.
// 10240 - account contents = 10128 bytes
pub const MAX_BUFFER_SIZE: usize = 10128;

#[account]
pub struct TransactionBuffer {
    /// The multisig settings this belongs to.
    pub multi_wallet_settings: Pubkey,
    /// The bump for the multi_wallet
    pub multi_wallet_bump: u8,
    /// Flag to allow transaction to be executed
    pub can_execute: bool,
    /// Flag to allow execution without sigverify once sufficient threshold is met
    pub permissionless_execution: bool,
    // Transaction valid till
    pub expiry: u64,
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
    /// Buffer hash for all the buffer extend instruction
    pub buffer_extend_hashes: Vec<[u8; 32]>,
    /// Members that voted for this transaction
    pub voters: Vec<MemberKey>,
    /// The buffer of the transaction message.
    pub buffer: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TransactionActionType {
    Create,
    CreateWithPermissionlessExecution,
    Execute,
    Vote,
    Sync,
    Close,
    ChangeConfig,
    AddNewMember,
    TokenTransferIntent,
    NativeTransferIntent,
}

impl TransactionActionType {
    pub fn to_bytes(&self) -> &[u8] {
        match &self {
            TransactionActionType::Create => b"create",
            TransactionActionType::CreateWithPermissionlessExecution => {
                b"create_with_permissionless_execution"
            }
            TransactionActionType::Execute => b"execute",
            TransactionActionType::Vote => b"vote",
            TransactionActionType::Sync => b"sync",
            TransactionActionType::Close => b"close",
            TransactionActionType::ChangeConfig => b"change_config",
            TransactionActionType::AddNewMember => b"add_new_member",
            TransactionActionType::TokenTransferIntent => b"token_transfer_intent",
            TransactionActionType::NativeTransferIntent => b"native_transfer_intent",
        }
    }
}

impl TransactionBuffer {
    pub fn init(
        &mut self,
        settings: &Account<'_, Settings>,
        creator: MemberKey,
        payer: Pubkey,
        buffer_index: u8,
        args: &TransactionBufferCreateArgs,
        bump: u8,
    ) -> Result<()> {
        self.multi_wallet_settings = settings.key();
        self.multi_wallet_bump = settings.multi_wallet_bump;
        self.can_execute = false;
        self.permissionless_execution = args.permissionless_execution;
        self.buffer_extend_hashes = args.buffer_extend_hashes.to_vec();
        self.creator = creator;
        self.payer = payer;
        self.buffer_index = buffer_index;
        self.final_buffer_hash = args.final_buffer_hash;
        self.final_buffer_size = args.final_buffer_size;
        self.buffer = args.buffer.to_vec();
        self.bump = bump;
        self.expiry = Clock::get().unwrap().unix_timestamp as u64 + 3 * 60; // transaction only valid for 3 mins
        self.voters = Vec::new();
        Ok(())
    }

    pub fn size(
        number_of_voters: u8,
        final_message_buffer_size: u16,
        number_of_extend_buffers: usize,
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
            1  +  // execute without sigverify
            8  +  // transaction expiry
            32 +  // rent_payer
            1  +  // bump
            1  +  // buffer_index
            32 +  // final_buffer_hash
            2  +  // final_buffer_size
            MemberKey::INIT_SPACE +  // creator
            (4 + number_of_extend_buffers * 32 ) + // extend buffer hash
            (4 + usize::from(number_of_voters) * MemberKey::INIT_SPACE)  +  // number of signers 
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

    pub fn add_voter(&mut self, voter: &MemberKey) {
        if !self.voters.contains(voter) {
            self.voters.push(*voter);
        }
    }
}

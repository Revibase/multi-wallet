use anchor_lang::prelude::*;

use super::CompiledInstruction;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TransactionMessage {
    /// The number of signer pubkeys in the account_keys vec.
    pub num_signers: u8,
    /// The number of writable signer pubkeys in the account_keys vec.
    pub num_writable_signers: u8,
    /// The number of writable non-signer pubkeys in the account_keys vec.
    pub num_writable_non_signers: u8,
    /// The number of static account keys in the account_keys vec.
    pub num_account_keys: u8,
    /// List of instructions making up the tx.
    pub instructions: Vec<CompiledInstruction>,
    /// List of address table lookups used to load additional accounts
    /// for this transaction.
    pub address_table_lookups: Vec<TransactionMessageAddressTableLookup>,
}
/// Address table lookups describe an on-chain address lookup table to use
/// for loading more readonly and writable accounts in a single tx.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransactionMessageAddressTableLookup {
    /// Address lookup table account key
    pub account_key_index: u8,
    /// List of indexes used to load writable account addresses
    pub writable_indexes: Vec<u8>,
    /// List of indexes used to load readonly account addresses
    pub readonly_indexes: Vec<u8>,
}

use anchor_lang::prelude::*;

use crate::error::MultisigError;

use super::{CompiledInstruction, MessageAddressTableLookup, VaultTransactionMessage};

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

impl TransactionMessage {
    pub fn convert_to_vault_transaction_message(
        &self,
        remaining_accounts: &[AccountInfo],
    ) -> Result<VaultTransactionMessage> {
        let num_lookups = self.address_table_lookups.len();
        let account_keys_end_index = num_lookups + usize::from(self.num_account_keys);
        let account_keys = remaining_accounts
            .get(num_lookups..account_keys_end_index)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?
            .iter()
            .map(|f| f.key())
            .collect::<Vec<_>>();

        let message_address_table_loopups: Vec<MessageAddressTableLookup> = self
            .address_table_lookups
            .iter()
            .map(|f| MessageAddressTableLookup {
                account_key: remaining_accounts
                    .get(f.account_key_index as usize)
                    .ok_or(MultisigError::InvalidNumberOfAccounts)
                    .unwrap()
                    .key(),
                writable_indexes: f.writable_indexes.clone(),
                readonly_indexes: f.readonly_indexes.clone(),
            })
            .collect::<Vec<MessageAddressTableLookup>>();

        Ok(VaultTransactionMessage {
            num_signers: self.num_signers,
            num_writable_signers: self.num_writable_signers,
            num_writable_non_signers: self.num_writable_non_signers,
            account_keys,
            instructions: self.instructions.clone(),
            address_table_lookups: message_address_table_loopups,
        })
    }
}

use anchor_lang::prelude::*;

use crate::error::MultisigError;

use super::{CompiledInstruction, MessageAddressTableLookup, VaultTransactionMessage};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TransactionMessage {
    pub num_signers: u8,
    pub num_writable_signers: u8,
    pub num_writable_non_signers: u8,
    pub num_account_keys: u8,
    pub instructions: Vec<CompiledInstruction>,
    pub address_table_lookups: Vec<TransactionMessageAddressTableLookup>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransactionMessageAddressTableLookup {
    pub lookup_table_address_index: u8,
    pub writable_indexes: Vec<u8>,
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
                lookup_table_address: remaining_accounts
                    .get(f.lookup_table_address_index as usize)
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

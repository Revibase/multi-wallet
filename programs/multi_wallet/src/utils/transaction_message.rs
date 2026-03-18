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
            .map(|f| {
                Ok(MessageAddressTableLookup {
                    lookup_table_address: remaining_accounts
                        .get(f.lookup_table_address_index as usize)
                        .ok_or(MultisigError::InvalidNumberOfAccounts)?
                        .key(),
                    writable_indexes: f.writable_indexes.clone(),
                    readonly_indexes: f.readonly_indexes.clone(),
                })
            })
            .collect::<Result<Vec<MessageAddressTableLookup>>>()?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::account_info::AccountInfo;

    fn leak_pubkey(pk: Pubkey) -> &'static Pubkey {
        Box::leak(Box::new(pk))
    }

    fn make_account_info(key: Pubkey) -> AccountInfo<'static> {
        let key = leak_pubkey(key);
        let owner = leak_pubkey(Pubkey::new_unique());
        let lamports: &'static mut u64 = Box::leak(Box::new(0u64));
        let data: &'static mut [u8] = Box::leak(vec![0u8; 0].into_boxed_slice());
        AccountInfo::new(key, false, false, lamports, data, owner, false, 0)
    }

    #[test]
    fn test_convert_to_vault_too_few_remaining_accounts_fails() {
        let msg = TransactionMessage {
            num_signers: 0,
            num_writable_signers: 0,
            num_writable_non_signers: 0,
            num_account_keys: 3,
            instructions: vec![],
            address_table_lookups: vec![],
        };
        let accounts = vec![make_account_info(Pubkey::new_unique()), make_account_info(Pubkey::new_unique())];
        let res = msg.convert_to_vault_transaction_message(&accounts);
        assert!(res.is_err());
    }

    #[test]
    fn test_convert_to_vault_lookup_index_oob_fails() {
        let msg = TransactionMessage {
            num_signers: 0,
            num_writable_signers: 0,
            num_writable_non_signers: 0,
            num_account_keys: 1,
            instructions: vec![],
            address_table_lookups: vec![TransactionMessageAddressTableLookup {
                lookup_table_address_index: 5,
                writable_indexes: vec![],
                readonly_indexes: vec![],
            }],
        };
        let accounts = vec![make_account_info(Pubkey::new_unique())];
        let res = msg.convert_to_vault_transaction_message(&accounts);
        assert!(res.is_err());
    }

    #[test]
    fn test_convert_to_vault_valid_no_lookups() {
        let k0 = Pubkey::new_unique();
        let k1 = Pubkey::new_unique();
        let msg = TransactionMessage {
            num_signers: 1,
            num_writable_signers: 0,
            num_writable_non_signers: 0,
            num_account_keys: 2,
            instructions: vec![],
            address_table_lookups: vec![],
        };
        let accounts = vec![make_account_info(k0), make_account_info(k1)];
        let vault = msg.convert_to_vault_transaction_message(&accounts).unwrap();
        assert_eq!(vault.account_keys.len(), 2);
        assert_eq!(vault.account_keys[0], k0);
        assert_eq!(vault.account_keys[1], k1);
        assert_eq!(vault.num_signers, 1);
    }

    #[test]
    fn test_convert_to_vault_valid_with_lookups() {
        let alt_key = Pubkey::new_unique();
        let k0 = Pubkey::new_unique();
        let msg = TransactionMessage {
            num_signers: 0,
            num_writable_signers: 0,
            num_writable_non_signers: 0,
            num_account_keys: 1,
            instructions: vec![],
            address_table_lookups: vec![TransactionMessageAddressTableLookup {
                lookup_table_address_index: 0,
                writable_indexes: vec![],
                readonly_indexes: vec![],
            }],
        };
        let accounts = vec![make_account_info(alt_key), make_account_info(k0)];
        let vault = msg.convert_to_vault_transaction_message(&accounts).unwrap();
        assert_eq!(vault.account_keys.len(), 1);
        assert_eq!(vault.account_keys[0], k0);
        assert_eq!(vault.address_table_lookups.len(), 1);
        assert_eq!(vault.address_table_lookups[0].lookup_table_address, alt_key);
    }
}

use anchor_lang::prelude::*;

use crate::error::MultisigError;

use super::{CompiledInstruction, VaultTransactionMessage};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TransactionMessage {
    pub num_signers: u8,
    pub num_writable_signers: u8,
    pub num_writable_non_signers: u8,
    pub num_account_keys: u8,
    pub instructions: Vec<CompiledInstruction>,
}

impl TransactionMessage {
    pub fn convert_to_vault_transaction_message(
        &self,
        remaining_accounts: &[AccountInfo],
    ) -> Result<VaultTransactionMessage> {
        let account_keys_end_index = usize::from(self.num_account_keys);
        let account_keys_slice = remaining_accounts
            .get(0..account_keys_end_index)
            .ok_or(MultisigError::InvalidNumberOfAccounts)?;
        let mut account_keys = Vec::with_capacity(account_keys_slice.len());
        for account in account_keys_slice {
            account_keys.push(account.key());
        }

        Ok(VaultTransactionMessage {
            num_signers: self.num_signers,
            num_writable_signers: self.num_writable_signers,
            num_writable_non_signers: self.num_writable_non_signers,
            account_keys,
            instructions: self.instructions.clone(),
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
        };
        let accounts = vec![
            make_account_info(Pubkey::new_unique()),
            make_account_info(Pubkey::new_unique()),
        ];
        let res = msg.convert_to_vault_transaction_message(&accounts);
        assert!(res.is_err());
    }
}

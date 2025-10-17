use crate::MultisigError;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Debug)]
pub struct VaultTransactionMessage {
    pub num_signers: u8,
    pub num_writable_signers: u8,
    pub num_writable_non_signers: u8,
    pub account_keys: Vec<Pubkey>,
    pub instructions: Vec<CompiledInstruction>,
    pub address_table_lookups: Vec<MessageAddressTableLookup>,
}

impl VaultTransactionMessage {
    pub fn validate(&self) -> Result<()> {
        let num_all_account_keys = self.account_keys.len()
            + self
                .address_table_lookups
                .iter()
                .map(|lookup| lookup.writable_indexes.len() + lookup.readonly_indexes.len())
                .sum::<usize>();

        require!(
            usize::from(self.num_signers) <= self.account_keys.len(),
            MultisigError::InvalidTransactionMessage
        );
        require!(
            self.num_writable_signers <= self.num_signers,
            MultisigError::InvalidTransactionMessage
        );
        require!(
            usize::from(self.num_writable_non_signers)
                <= self
                    .account_keys
                    .len()
                    .saturating_sub(usize::from(self.num_signers)),
            MultisigError::InvalidTransactionMessage
        );

        for instruction in &self.instructions {
            require!(
                usize::from(instruction.program_address_index) < num_all_account_keys,
                MultisigError::InvalidTransactionMessage
            );

            for account_index in &instruction.account_indices {
                require!(
                    usize::from(*account_index) < num_all_account_keys,
                    MultisigError::InvalidTransactionMessage
                );
            }
        }

        Ok(())
    }

    pub fn num_all_account_keys(&self) -> usize {
        let num_account_keys_from_lookups = self
            .address_table_lookups
            .iter()
            .map(|lookup| lookup.writable_indexes.len() + lookup.readonly_indexes.len())
            .sum::<usize>();

        self.account_keys.len() + num_account_keys_from_lookups
    }

    pub fn is_static_writable_index(&self, key_index: usize) -> bool {
        let num_account_keys = self.account_keys.len();
        let num_signers = usize::from(self.num_signers);
        let num_writable_signers = usize::from(self.num_writable_signers);
        let num_writable_non_signers = usize::from(self.num_writable_non_signers);

        if key_index >= num_account_keys {
            return false;
        }

        if key_index < num_writable_signers {
            return true;
        }

        if key_index >= num_signers {
            let index_into_non_signers = key_index.saturating_sub(num_signers);
            return index_into_non_signers < num_writable_non_signers;
        }

        false
    }

    pub fn is_signer_index(&self, key_index: usize) -> bool {
        key_index < usize::from(self.num_signers)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CompiledInstruction {
    pub program_address_index: u8,
    pub account_indices: Vec<u8>,
    pub data: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MessageAddressTableLookup {
    pub lookup_table_address: Pubkey,
    pub writable_indexes: Vec<u8>,
    pub readonly_indexes: Vec<u8>,
}

use anchor_lang::prelude::*;
use anchor_lang::solana_program::address_lookup_table::{program::ID, state::AddressLookupTable};
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use std::collections::HashMap;
use std::convert::From;

use crate::{state::*, MultisigError};

pub struct ExecutableTransactionMessage<'a, 'info> {
    message: VaultTransactionMessage,
    static_accounts: Vec<&'a AccountInfo<'info>>,
    loaded_writable_accounts: Vec<&'a AccountInfo<'info>>,
    loaded_readonly_accounts: Vec<&'a AccountInfo<'info>>,
}

impl<'a, 'info> ExecutableTransactionMessage<'a, 'info> {
    pub fn new_validated(
        message: VaultTransactionMessage,
        message_account_infos: &'a [AccountInfo<'info>],
        address_lookup_table_account_infos: &'a [AccountInfo<'info>],
        vault_pubkey: &'a Pubkey,
    ) -> Result<Self> {
        require_eq!(
            address_lookup_table_account_infos.len(),
            message.address_table_lookups.len(),
            MultisigError::InvalidNumberOfAccounts
        );
        let lookup_tables: HashMap<&Pubkey, &AccountInfo> = address_lookup_table_account_infos
            .iter()
            .enumerate()
            .map(|(index, maybe_lookup_table)| {
                require!(
                    maybe_lookup_table.owner == &ID,
                    MultisigError::InvalidAccount
                );
                require!(
                    message
                        .address_table_lookups
                        .get(index)
                        .map(|lookup| &lookup.account_key)
                        == Some(maybe_lookup_table.key),
                    MultisigError::InvalidAccount
                );
                Ok((maybe_lookup_table.key, maybe_lookup_table))
            })
            .collect::<Result<HashMap<&Pubkey, &AccountInfo>>>()?;

        require_eq!(
            message_account_infos.len(),
            message.num_all_account_keys(),
            MultisigError::InvalidNumberOfAccounts
        );

        let mut static_accounts = Vec::new();

        for (i, account_key) in message.account_keys.iter().enumerate() {
            let account_info = &message_account_infos[i];
            require_keys_eq!(
                *account_info.key,
                *account_key,
                MultisigError::InvalidAccount
            );
            // If the account is marked as signer in the message, it must be a signer in the account infos too.
            // Unless it's a vault PDA, as they cannot be passed as signers to `remaining_accounts`,
            // because they are PDA's and can't sign the transaction.
            if message.is_signer_index(i) && account_info.key != vault_pubkey {
                require!(account_info.is_signer, MultisigError::InvalidAccount);
            }
            if message.is_static_writable_index(i) {
                require!(account_info.is_writable, MultisigError::InvalidAccount);
            }
            static_accounts.push(account_info);
        }

        let mut writable_accounts = Vec::new();
        let mut readonly_accounts = Vec::new();

        let mut message_indexes_cursor = message.account_keys.len();
        for lookup in message.address_table_lookups.iter() {
            let lookup_table_data = &lookup_tables
                .get(&lookup.account_key)
                .unwrap()
                .data
                .borrow()[..];
            let lookup_table = AddressLookupTable::deserialize(lookup_table_data)
                .map_err(|_| MultisigError::InvalidAccount)?;

            for (i, index_in_lookup_table) in lookup.writable_indexes.iter().enumerate() {
                let index = message_indexes_cursor + i;
                let loaded_account_info = &message_account_infos
                    .get(index)
                    .ok_or(MultisigError::InvalidNumberOfAccounts)?;
                require_eq!(
                    loaded_account_info.is_writable,
                    true,
                    MultisigError::InvalidAccount
                );
                let pubkey_from_lookup_table = lookup_table
                    .addresses
                    .get(usize::from(*index_in_lookup_table))
                    .ok_or(MultisigError::InvalidAccount)?;
                require_keys_eq!(
                    *loaded_account_info.key,
                    *pubkey_from_lookup_table,
                    MultisigError::InvalidAccount
                );

                writable_accounts.push(*loaded_account_info);
            }
            message_indexes_cursor += lookup.writable_indexes.len();

            for (i, index_in_lookup_table) in lookup.readonly_indexes.iter().enumerate() {
                let index = message_indexes_cursor + i;
                let loaded_account_info = &message_account_infos
                    .get(index)
                    .ok_or(MultisigError::InvalidNumberOfAccounts)?;
                let pubkey_from_lookup_table = lookup_table
                    .addresses
                    .get(usize::from(*index_in_lookup_table))
                    .ok_or(MultisigError::InvalidAccount)?;
                require_keys_eq!(
                    *loaded_account_info.key,
                    *pubkey_from_lookup_table,
                    MultisigError::InvalidAccount
                );

                readonly_accounts.push(*loaded_account_info);
            }
            message_indexes_cursor += lookup.readonly_indexes.len();
        }

        Ok(Self {
            message,
            static_accounts,
            loaded_writable_accounts: writable_accounts,
            loaded_readonly_accounts: readonly_accounts,
        })
    }

    pub fn execute_message(
        self,
        vault_seeds: &[&[u8]],
        protected_accounts: &[Pubkey],
    ) -> Result<()> {
        for (ix, account_infos) in self.to_instructions_and_accounts().iter() {
            for account_meta in ix.accounts.iter().filter(|m| m.is_writable) {
                require!(
                    !protected_accounts.contains(&account_meta.pubkey),
                    MultisigError::ProtectedAccount
                );
            }
            invoke_signed(&ix, &account_infos, &[vault_seeds])?;
        }
        Ok(())
    }

    fn get_account_by_index(&self, index: usize) -> Result<&'a AccountInfo<'info>> {
        if index < self.static_accounts.len() {
            return Ok(self.static_accounts[index]);
        }

        let index = index - self.static_accounts.len();
        if index < self.loaded_writable_accounts.len() {
            return Ok(self.loaded_writable_accounts[index]);
        }

        let index = index - self.loaded_writable_accounts.len();
        if index < self.loaded_readonly_accounts.len() {
            return Ok(self.loaded_readonly_accounts[index]);
        }

        Err(MultisigError::InvalidTransactionMessage.into())
    }

    fn is_writable_index(&self, index: usize) -> bool {
        if self.message.is_static_writable_index(index) {
            return true;
        }

        if index < self.static_accounts.len() {
            return false;
        }

        let index = index - self.static_accounts.len();

        index < self.loaded_writable_accounts.len()
    }

    pub fn to_instructions_and_accounts(mut self) -> Vec<(Instruction, Vec<AccountInfo<'info>>)> {
        let mut executable_instructions = vec![];

        for ms_compiled_instruction in core::mem::take(&mut self.message.instructions) {
            let ix_accounts: Vec<(AccountInfo<'info>, AccountMeta)> = ms_compiled_instruction
                .account_indexes
                .iter()
                .map(|account_index| {
                    let account_index = usize::from(*account_index);
                    let account_info = self.get_account_by_index(account_index).unwrap();
                    let is_signer = self.message.is_signer_index(account_index);

                    let account_meta = if self.is_writable_index(account_index) {
                        AccountMeta::new(*account_info.key, is_signer)
                    } else {
                        AccountMeta::new_readonly(*account_info.key, is_signer)
                    };

                    (account_info.to_account_info(), account_meta)
                })
                .collect();

            let ix_program_account_info = self
                .get_account_by_index(usize::from(ms_compiled_instruction.program_id_index))
                .unwrap();

            let ix = Instruction {
                program_id: *ix_program_account_info.key,
                accounts: ix_accounts
                    .iter()
                    .map(|(_, account_meta)| account_meta.clone())
                    .collect(),
                data: ms_compiled_instruction.data,
            };

            let mut account_infos: Vec<AccountInfo> = ix_accounts
                .into_iter()
                .map(|(account_info, _)| account_info)
                .collect();
            account_infos.push(ix_program_account_info.to_account_info());

            executable_instructions.push((ix, account_infos));
        }

        executable_instructions
    }
}

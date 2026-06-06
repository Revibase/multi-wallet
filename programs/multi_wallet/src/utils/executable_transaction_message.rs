use crate::{MultisigError, VaultTransactionMessage};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use std::convert::From;

pub struct ExecutableTransactionMessage<'a, 'info> {
    message: VaultTransactionMessage,
    static_accounts: Vec<&'a AccountInfo<'info>>,
}

impl<'a, 'info> ExecutableTransactionMessage<'a, 'info> {
    pub fn new_validated(
        message: VaultTransactionMessage,
        message_account_infos: &'a [AccountInfo<'info>],
        vault_pubkey: &'a Pubkey,
    ) -> Result<Self> {
        require_eq!(
            message_account_infos.len(),
            message.num_all_account_keys(),
            MultisigError::InvalidNumberOfAccounts
        );

        let mut static_accounts = Vec::with_capacity(message.account_keys.len());

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

        Ok(Self {
            message,
            static_accounts,
        })
    }

    pub fn execute_message(
        self,
        vault_seeds: &[&[u8]],
        protected_accounts: &[Pubkey],
    ) -> Result<()> {
        for (ix, account_infos) in self.to_instructions_and_accounts()?.iter() {
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

        Err(MultisigError::InvalidTransactionMessage.into())
    }

    fn is_writable_index(&self, index: usize) -> bool {
        return self.message.is_static_writable_index(index);
    }

    pub fn to_instructions_and_accounts(
        mut self,
    ) -> Result<Vec<(Instruction, Vec<AccountInfo<'info>>)>> {
        let mut executable_instructions = Vec::with_capacity(self.message.instructions.len());

        for ms_compiled_instruction in core::mem::take(&mut self.message.instructions) {
            let ix_accounts: Vec<(AccountInfo<'info>, AccountMeta)> = ms_compiled_instruction
                .account_indices
                .iter()
                .map(|account_index| {
                    let account_index = usize::from(*account_index);
                    let account_info = self
                        .get_account_by_index(account_index)
                        .map_err(|_| MultisigError::InvalidAccountIndex)?;
                    let is_signer = self.message.is_signer_index(account_index);

                    let account_meta = if self.is_writable_index(account_index) {
                        AccountMeta::new(*account_info.key, is_signer)
                    } else {
                        AccountMeta::new_readonly(*account_info.key, is_signer)
                    };

                    Ok((account_info.to_account_info(), account_meta))
                })
                .collect::<Result<Vec<_>>>()?;

            let ix_program_account_info = self
                .get_account_by_index(usize::from(ms_compiled_instruction.program_address_index))
                .map_err(|_| MultisigError::InvalidAccountIndex)?;

            let (account_infos, account_metas): (Vec<_>, Vec<_>) = ix_accounts.into_iter().unzip();

            let ix = Instruction {
                program_id: *ix_program_account_info.key,
                accounts: account_metas,
                data: ms_compiled_instruction.data,
            };

            let mut account_infos: Vec<AccountInfo> = account_infos;
            account_infos.push(ix_program_account_info.to_account_info());

            executable_instructions.push((ix, account_infos));
        }

        Ok(executable_instructions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leak_pubkey(pk: Pubkey) -> &'static Pubkey {
        Box::leak(Box::new(pk))
    }

    fn make_account(
        key: Pubkey,
        owner: Pubkey,
        is_signer: bool,
        is_writable: bool,
        data_len: usize,
    ) -> AccountInfo<'static> {
        let key = leak_pubkey(key);
        let owner = leak_pubkey(owner);
        let lamports: &'static mut u64 = Box::leak(Box::new(0u64));
        let data: &'static mut [u8] = Box::leak(vec![0u8; data_len].into_boxed_slice());
        AccountInfo::new(key, is_signer, is_writable, lamports, data, owner, false, 0)
    }

    #[test]
    fn test_signer_required_for_non_vault_signer_index() {
        let k0 = Pubkey::new_unique();
        let vault = Pubkey::new_unique();
        let owner = Pubkey::new_unique();

        let message = VaultTransactionMessage {
            num_signers: 1,
            num_writable_signers: 0,
            num_writable_non_signers: 0,
            account_keys: vec![k0],
            instructions: vec![],
        };

        let a0 = make_account(k0, owner, false, false, 0);
        let accounts = [a0];
        let res = ExecutableTransactionMessage::new_validated(message, &accounts, &vault);
        assert!(res.is_err());
    }

    #[test]
    fn test_signer_not_required_for_vault_pubkey() {
        let vault = Pubkey::new_unique();
        let owner = Pubkey::new_unique();

        let message = VaultTransactionMessage {
            num_signers: 1,
            num_writable_signers: 0,
            num_writable_non_signers: 0,
            account_keys: vec![vault],
            instructions: vec![],
        };

        let a0 = make_account(vault, owner, false, false, 0);
        let vault_pk = *a0.key;
        let accounts = [a0];
        ExecutableTransactionMessage::new_validated(message, &accounts, &vault_pk).unwrap();
    }

    #[test]
    fn test_static_writable_index_requires_writable_accountinfo() {
        let k0 = Pubkey::new_unique();
        let vault = Pubkey::new_unique();
        let owner = Pubkey::new_unique();

        let message = VaultTransactionMessage {
            num_signers: 1,
            num_writable_signers: 1,
            num_writable_non_signers: 0,
            account_keys: vec![k0],
            instructions: vec![],
        };

        let a0 = make_account(k0, owner, true, false, 0);
        let accounts = [a0];
        let res = ExecutableTransactionMessage::new_validated(message, &accounts, &vault);
        assert!(res.is_err());
    }
}

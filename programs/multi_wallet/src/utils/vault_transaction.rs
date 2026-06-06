use crate::MultisigError;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Debug)]
pub struct VaultTransactionMessage {
    pub num_signers: u8,
    pub num_writable_signers: u8,
    pub num_writable_non_signers: u8,
    pub account_keys: Vec<Pubkey>,
    pub instructions: Vec<CompiledInstruction>,
}

impl VaultTransactionMessage {
    pub fn validate(&self) -> Result<()> {
        let num_all_account_keys: usize = self.account_keys.len();

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
        self.account_keys.len()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(
        num_signers: u8,
        num_writable_signers: u8,
        num_writable_non_signers: u8,
        account_keys_len: usize,
        instructions: Vec<CompiledInstruction>,
    ) -> VaultTransactionMessage {
        VaultTransactionMessage {
            num_signers,
            num_writable_signers,
            num_writable_non_signers,
            account_keys: (0..account_keys_len)
                .map(|_| Pubkey::new_unique())
                .collect(),
            instructions,
        }
    }

    #[test]
    fn test_validate_num_signers_exceeds_account_keys_fails() {
        let m = msg(3, 0, 0, 2, vec![]);
        assert!(m.validate().is_err());
    }

    #[test]
    fn test_validate_num_writable_signers_exceeds_num_signers_fails() {
        let m = msg(2, 3, 0, 4, vec![]);
        assert!(m.validate().is_err());
    }

    #[test]
    fn test_validate_num_writable_non_signers_exceeds_available_fails() {
        let m = msg(2, 0, 10, 4, vec![]);
        assert!(m.validate().is_err());
    }

    #[test]
    fn test_validate_instruction_program_index_oob_fails() {
        let mut m = msg(0, 0, 0, 2, vec![]);
        m.instructions.push(CompiledInstruction {
            program_address_index: 10,
            account_indices: vec![],
            data: vec![],
        });
        assert!(m.validate().is_err());
    }

    #[test]
    fn test_validate_instruction_account_index_oob_fails() {
        let mut m = msg(0, 0, 0, 2, vec![]);
        m.instructions.push(CompiledInstruction {
            program_address_index: 0,
            account_indices: vec![5],
            data: vec![],
        });
        assert!(m.validate().is_err());
    }

    #[test]
    fn test_validate_minimal_valid() {
        let m = msg(1, 0, 0, 1, vec![]);
        assert!(m.validate().is_ok());
    }

    #[test]
    fn test_validate_with_instruction_valid() {
        let mut m = msg(1, 1, 0, 2, vec![]);
        m.instructions.push(CompiledInstruction {
            program_address_index: 1,
            account_indices: vec![0, 1],
            data: vec![1, 2, 3],
        });
        assert!(m.validate().is_ok());
    }

    #[test]
    fn test_num_all_account_keys_static_only() {
        let m = msg(0, 0, 0, 5, vec![]);
        assert_eq!(m.num_all_account_keys(), 5);
    }

    #[test]
    fn test_is_signer_index() {
        let m = msg(2, 0, 0, 4, vec![]);
        assert!(m.is_signer_index(0));
        assert!(m.is_signer_index(1));
        assert!(!m.is_signer_index(2));
        assert!(!m.is_signer_index(3));
    }

    #[test]
    fn test_is_static_writable_index() {
        let m = msg(3, 2, 1, 5, vec![]);
        assert!(m.is_static_writable_index(0));
        assert!(m.is_static_writable_index(1));
        assert!(!m.is_static_writable_index(2));
        assert!(m.is_static_writable_index(3));
        assert!(!m.is_static_writable_index(4));
        assert!(!m.is_static_writable_index(5));
    }

    #[test]
    fn test_validate_instruction_index_at_num_all_account_keys_rejected() {
        let mut m = msg(0, 0, 0, 2, vec![]);
        m.instructions.push(CompiledInstruction {
            program_address_index: 3,
            account_indices: vec![],
            data: vec![],
        });
        assert!(m.validate().is_err());
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CompiledInstruction {
    pub program_address_index: u8,
    pub account_indices: Vec<u8>,
    pub data: Vec<u8>,
}

use anchor_lang::prelude::*;

use crate::error::MultisigError;

#[account]
pub struct WhitelistedAddressTree {
    pub whitelisted_address_trees: Vec<Pubkey>,
    pub bump: u8,
}

impl WhitelistedAddressTree {
    /// Matches the fixed allocation in `size()` (512 bytes / 32 bytes per pubkey = 16 pubkeys).
    pub const MAX_WHITELISTED_ADDRESS_TREES: usize = 16;

    pub fn size() -> usize {
        8 + 4 + 512 + 1
    }

    pub fn extract_address_tree_index(&self, address_tree: &Pubkey) -> Result<u8> {
        Ok(self
            .whitelisted_address_trees
            .iter()
            .position(|f| f.eq(address_tree))
            .ok_or(MultisigError::InvalidAddressTree)? as u8)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_address_tree_index_found() {
        let pk1 = Pubkey::new_unique();
        let pk2 = Pubkey::new_unique();
        let pk3 = Pubkey::new_unique();
        let tree = WhitelistedAddressTree {
            whitelisted_address_trees: vec![pk1, pk2, pk3],
            bump: 0,
        };
        assert_eq!(tree.extract_address_tree_index(&pk1).unwrap(), 0);
        assert_eq!(tree.extract_address_tree_index(&pk2).unwrap(), 1);
        assert_eq!(tree.extract_address_tree_index(&pk3).unwrap(), 2);
    }

    #[test]
    fn test_extract_address_tree_index_not_found() {
        let pk1 = Pubkey::new_unique();
        let pk2 = Pubkey::new_unique();
        let tree = WhitelistedAddressTree {
            whitelisted_address_trees: vec![pk1],
            bump: 0,
        };
        assert!(tree.extract_address_tree_index(&pk2).is_err());
    }

    #[test]
    fn test_extract_address_tree_index_empty() {
        let tree = WhitelistedAddressTree {
            whitelisted_address_trees: vec![],
            bump: 0,
        };
        assert!(tree
            .extract_address_tree_index(&Pubkey::new_unique())
            .is_err());
    }

    #[test]
    fn test_extract_address_tree_index_at_max() {
        let pubkeys: Vec<Pubkey> = (0..WhitelistedAddressTree::MAX_WHITELISTED_ADDRESS_TREES)
            .map(|_| Pubkey::new_unique())
            .collect();
        let last_pk = *pubkeys.last().unwrap();
        let tree = WhitelistedAddressTree {
            whitelisted_address_trees: pubkeys,
            bump: 0,
        };
        assert_eq!(
            tree.extract_address_tree_index(&last_pk).unwrap(),
            (WhitelistedAddressTree::MAX_WHITELISTED_ADDRESS_TREES - 1) as u8
        );
    }

    #[test]
    fn test_extract_address_tree_first_element() {
        let pk = Pubkey::new_unique();
        let tree = WhitelistedAddressTree {
            whitelisted_address_trees: vec![pk],
            bump: 255,
        };
        assert_eq!(tree.extract_address_tree_index(&pk).unwrap(), 0);
    }
}

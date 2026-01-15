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

use anchor_lang::prelude::*;

use crate::error::MultisigError;

#[account]
pub struct WhitelistedAddressTree {
    pub whitelisted_address_trees: Vec<Pubkey>,
    pub bump: u8,
}

impl WhitelistedAddressTree {
    pub fn size() -> usize {
        8 + 4 + 512 + 1 //allow up to 16 trees
    }

    pub fn extract_address_tree_index(&self, address_tree: &Pubkey) -> Result<u8> {
        Ok(self
            .whitelisted_address_trees
            .iter()
            .position(|f| f.eq(address_tree))
            .ok_or(MultisigError::InvalidAddressTree)? as u8)
    }
}

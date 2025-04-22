use anchor_lang::prelude::*;

#[derive(Debug)]
#[account(zero_copy)]
pub struct DomainConfig {
    pub authority: Pubkey,
    pub rp_id_hash: [u8; 32],
    pub bump: u8,
    pub rp_id_length: u8,
    pub origin_length: u8,
    pub rp_id: [u8; 256],
    pub origin: [u8; 256],
}

impl DomainConfig {
    pub fn size() -> usize {
        return 8 + 32 + 1 + 256 + 1 + 32 + 1 + 256;
    }
}

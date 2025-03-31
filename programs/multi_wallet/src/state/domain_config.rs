use anchor_lang::prelude::*;

#[derive(Debug)]
#[account(zero_copy)]
pub struct DomainConfig {
    pub rp_id_hash: [u8; 32],
    pub origin_length: u8,
    pub origin: [u8; 256],
    pub bump: u8,
    pub authority: Pubkey,
    pub padding: [u8; 128],
}

impl DomainConfig {
    pub fn size() -> usize {
        return 8 + 32 + 1 + 256 + 1 + 32 + 128;
    }
}

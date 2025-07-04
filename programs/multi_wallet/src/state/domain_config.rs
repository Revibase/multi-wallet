use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct DomainConfig {
    pub origin_length: u16,
    pub authority: Pubkey,
    pub rp_id_hash: [u8; 32],
    pub bump: u8,
    pub is_disabled: u8,
    pub rp_id_length: u8,
    pub rp_id: [u8; 256],
    pub origin: [u8; 512],
    pub padding: [u8; 1],
}

impl DomainConfig {
    pub fn size() -> usize {
        return 8 + 2 + 32 + 32 + 1 + 1 + 1 + 256 + 512 + 1;
    }
}

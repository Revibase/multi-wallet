use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct Delegate {
    pub bump: u8,
    pub multi_wallet_settings: Pubkey,
}

impl Delegate {
    pub fn size() -> usize {
        return 8 + 1 + 32;
    }
}

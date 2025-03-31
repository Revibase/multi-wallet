use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct Delegate {
    pub multi_wallet_settings: Pubkey,
    pub multi_wallet: Pubkey,
    pub bump: u8,
}

impl Delegate {
    pub fn size() -> usize {
        return 8 + 1 + 32 + 32;
    }
}

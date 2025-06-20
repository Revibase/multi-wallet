use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct GlobalCounter {
    pub index: u128,
}

impl GlobalCounter {
    pub fn size() -> usize {
        16
    }
}

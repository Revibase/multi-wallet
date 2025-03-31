use anchor_lang::prelude::*;

use crate::state::member::Member;

#[event]
pub struct ConfigEvent {
    pub create_key: Pubkey,
    pub members: Vec<Member>,
    pub threshold: u8,
    pub metadata: Option<Pubkey>,
}

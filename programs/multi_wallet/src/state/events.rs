use anchor_lang::prelude::*;

use crate::state::member::Member;

#[event]
pub struct ConfigEvent {
    pub members: Vec<Member>,
    pub threshold: u8,
}

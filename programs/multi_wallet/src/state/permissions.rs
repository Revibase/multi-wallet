use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

pub enum Permission {
    InitiateTransaction = 1 << 0,
    VoteTransaction = 1 << 1,
    ExecuteTransaction = 1 << 2,
    IsDelegate = 1 << 3,
    IsPermanent = 1 << 4,
}

/// Bitmask for permissions.
#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    PartialEq,
    Zeroable,
    Pod,
    Copy,
    Clone,
    Default,
    Debug,
)]
#[repr(C)]
pub struct Permissions {
    pub mask: u8,
}

impl Permissions {
    pub fn has(&self, permission: Permission) -> bool {
        self.mask & (permission as u8) != 0
    }
}

#[derive(Default)]
pub struct PermissionCounts {
    pub voters: usize,
    pub initiators: usize,
    pub executors: usize,
    pub is_permanent: usize,
}

use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Permission {
    InitiateTransaction = 1 << 0,
    VoteTransaction = 1 << 1,
    ExecuteTransaction = 1 << 2,
    IsPermanentMember = 1 << 3,
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

    pub fn from_permissions(permissions: Vec<Permission>) -> Self {
        let mask = permissions.iter().fold(0u8, |acc, f| acc | (*f as u8));

        Permissions { mask }
    }
}

#[derive(Default)]
pub struct PermissionCounts {
    pub voters: usize,
    pub initiators: usize,
    pub executors: usize,
    pub permanent_members: usize,
}

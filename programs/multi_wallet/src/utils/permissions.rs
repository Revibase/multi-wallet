use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Permission {
    InitiateTransaction = 1 << 0,
    VoteTransaction = 1 << 1,
    ExecuteTransaction = 1 << 2,
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
    pub transaction_manager: usize,
    pub administrator: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_has() {
        let perms = Permissions {
            mask: Permission::InitiateTransaction as u8 | Permission::VoteTransaction as u8,
        };
        assert!(perms.has(Permission::InitiateTransaction));
        assert!(perms.has(Permission::VoteTransaction));
        assert!(!perms.has(Permission::ExecuteTransaction));
    }

    #[test]
    fn test_from_permissions() {
        let perms = Permissions::from_permissions(vec![
            Permission::InitiateTransaction,
            Permission::ExecuteTransaction,
        ]);
        assert!(perms.has(Permission::InitiateTransaction));
        assert!(perms.has(Permission::ExecuteTransaction));
        assert!(!perms.has(Permission::VoteTransaction));
    }

    #[test]
    fn test_empty_permissions() {
        let perms = Permissions::default();
        assert!(!perms.has(Permission::InitiateTransaction));
        assert!(!perms.has(Permission::VoteTransaction));
        assert!(!perms.has(Permission::ExecuteTransaction));
    }

    #[test]
    fn test_all_permissions_combined() {
        let perms = Permissions::from_permissions(vec![
            Permission::InitiateTransaction,
            Permission::VoteTransaction,
            Permission::ExecuteTransaction,
        ]);
        assert!(perms.has(Permission::InitiateTransaction));
        assert!(perms.has(Permission::VoteTransaction));
        assert!(perms.has(Permission::ExecuteTransaction));
    }

    #[test]
    fn test_single_permission_initiate() {
        let perms = Permissions::from_permissions(vec![Permission::InitiateTransaction]);
        assert!(perms.has(Permission::InitiateTransaction));
        assert!(!perms.has(Permission::VoteTransaction));
        assert!(!perms.has(Permission::ExecuteTransaction));
        assert_eq!(perms.mask, 1);
    }

    #[test]
    fn test_single_permission_vote() {
        let perms = Permissions::from_permissions(vec![Permission::VoteTransaction]);
        assert!(!perms.has(Permission::InitiateTransaction));
        assert!(perms.has(Permission::VoteTransaction));
        assert!(!perms.has(Permission::ExecuteTransaction));
        assert_eq!(perms.mask, 2);
    }

    #[test]
    fn test_single_permission_execute() {
        let perms = Permissions::from_permissions(vec![Permission::ExecuteTransaction]);
        assert!(!perms.has(Permission::InitiateTransaction));
        assert!(!perms.has(Permission::VoteTransaction));
        assert!(perms.has(Permission::ExecuteTransaction));
        assert_eq!(perms.mask, 4);
    }

    #[test]
    fn test_permissions_equality() {
        let perms1 = Permissions::from_permissions(vec![
            Permission::InitiateTransaction,
            Permission::VoteTransaction,
        ]);
        let perms2 = Permissions::from_permissions(vec![
            Permission::VoteTransaction,
            Permission::InitiateTransaction,
        ]);
        assert_eq!(perms1, perms2);
    }

    #[test]
    fn test_duplicate_permissions_idempotent() {
        let perms = Permissions::from_permissions(vec![
            Permission::InitiateTransaction,
            Permission::InitiateTransaction,
            Permission::InitiateTransaction,
        ]);
        assert_eq!(perms.mask, 1);
    }

    #[test]
    fn test_permission_counts_default() {
        let counts = PermissionCounts::default();
        assert_eq!(counts.voters, 0);
        assert_eq!(counts.initiators, 0);
        assert_eq!(counts.executors, 0);
        assert_eq!(counts.permanent_members, 0);
        assert_eq!(counts.transaction_manager, 0);
        assert_eq!(counts.administrator, 0);
    }
}

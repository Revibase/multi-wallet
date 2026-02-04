use crate::{
    error::MultisigError, AddMemberArgs, EditMemberArgs, KeyType, Member, MemberKey,
    MultisigSettings, Permission, Permissions, RemoveMemberArgs, UserRole, SEED_MULTISIG,
};
use anchor_lang::prelude::*;
use std::collections::HashSet;

#[account]
pub struct Settings {
    pub index: u128,
    pub members: Vec<Member>,
    pub threshold: u8,
    pub multi_wallet_bump: u8,
    pub bump: u8,
    pub settings_address_tree_index: u8,
    pub latest_slot_number: u64,
}

impl Settings {
    pub fn size(member_len: usize) -> usize {
        8  + // anchor account discriminator
        16  + // index
        4 + (member_len * Member::INIT_SPACE) +// members (Vec prefix + elements)
        1  + // threshold
        1  + // multi_wallet bump
        1  + // settings bump
        1  + // settings_address_tree_index
        8 // latest slot number
    }
    pub fn edit_permissions(&mut self, members: Vec<EditMemberArgs>) -> Result<()> {
        MultisigSettings::edit_permissions(self, members)
    }
    pub fn add_members(&mut self, new_members: Vec<AddMemberArgs>) -> Result<Vec<AddMemberArgs>> {
        MultisigSettings::add_members(self, new_members)
    }

    pub fn remove_members(
        &mut self,
        member_pubkeys: Vec<RemoveMemberArgs>,
    ) -> Result<Vec<RemoveMemberArgs>> {
        MultisigSettings::remove_members(self, member_pubkeys)
    }

    pub fn set_threshold(&mut self, value: u8) -> Result<()> {
        MultisigSettings::set_threshold(self, value)
    }

    pub fn set_members(&mut self, members: Vec<Member>) -> Result<()> {
        MultisigSettings::set_members(self, members)
    }

    pub fn invariant(&self) -> Result<()> {
        MultisigSettings::invariant(self)
    }

    pub fn latest_slot_number_check(
        &mut self,
        slot_numbers: &[u64],
        sysvar_slot_history: &Option<UncheckedAccount>,
    ) -> Result<()> {
        MultisigSettings::latest_slot_number_check(self, slot_numbers, sysvar_slot_history)
    }

    pub fn get_settings_key_from_index_with_bump(index: u128, bump: u8) -> Result<Pubkey> {
        let index_bytes = index.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[SEED_MULTISIG, index_bytes.as_ref(), &[bump]];
        let pubkey =
            Pubkey::create_program_address(signer_seeds, &crate::ID).map_err(ProgramError::from)?;
        Ok(pubkey)
    }

    pub fn get_settings_key_from_index(index: u128) -> Result<Pubkey> {
        let index_bytes = index.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[SEED_MULTISIG, index_bytes.as_ref()];
        let (pubkey, _) = Pubkey::find_program_address(signer_seeds, &crate::ID);
        Ok(pubkey)
    }
}

impl MultisigSettings for Settings {
    fn is_compressed(&self) -> Result<bool> {
        Ok(false)
    }

    fn set_threshold(&mut self, value: u8) -> Result<()> {
        self.threshold = value;
        Ok(())
    }

    fn set_latest_slot_number(&mut self, value: u64) -> Result<()> {
        self.latest_slot_number = value;
        Ok(())
    }

    fn get_latest_slot_number(&self) -> Result<u64> {
        Ok(self.latest_slot_number)
    }

    fn get_threshold(&self) -> Result<u8> {
        Ok(self.threshold)
    }

    fn get_members(&self) -> Result<&[Member]> {
        Ok(self.members.as_slice())
    }

    fn get_members_mut(&mut self) -> Result<&mut [Member]> {
        Ok(&mut self.members)
    }

    fn extend_members(&mut self, members: Vec<Member>) -> Result<()> {
        self.members.extend(members);
        Ok(())
    }

    fn delete_members(&mut self, members: Vec<MemberKey>) -> Result<()> {
        let existing: HashSet<_> = self.members.iter().map(|m| m.pubkey).collect();
        if members.iter().any(|m| !existing.contains(&m)) {
            return err!(MultisigError::MemberNotFound);
        }
        let to_delete: HashSet<_> = HashSet::from_iter(members);
        self.members.retain(|m| !to_delete.contains(&m.pubkey));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_ed25519_member(
        idx: u8,
        perms: Vec<Permission>,
        role: UserRole,
        is_delegate: bool,
    ) -> Member {
        let mut key = [0u8; 33];
        key[0] = KeyType::Ed25519 as u8;
        key[1..].copy_from_slice(&[idx; 32]);
        let member_key = MemberKey {
            key_type: key[0],
            key,
        };
        Member {
            pubkey: member_key,
            role: role.to_u8(),
            permissions: Permissions::from_permissions(perms),
            user_address_tree_index: 0,
            is_delegate: if is_delegate { 1 } else { 0 },
        }
    }

    fn mk_secp256r1_member(idx: u8, perms: Vec<Permission>, role: UserRole) -> Member {
        let mut key = [0u8; 33];
        key[0] = KeyType::Secp256r1 as u8;
        key[1..].copy_from_slice(&[idx; 32]);
        let member_key = MemberKey {
            key_type: key[0],
            key,
        };
        Member {
            pubkey: member_key,
            role: role.to_u8(),
            permissions: Permissions::from_permissions(perms),
            user_address_tree_index: 0,
            is_delegate: 0,
        }
    }

    #[test]
    fn test_invariant_valid_minimal() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::Member,
                false,
            )],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_valid_multiple_members() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    1,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                ),
                mk_ed25519_member(
                    2,
                    vec![Permission::VoteTransaction, Permission::ExecuteTransaction],
                    UserRole::Member,
                    false,
                ),
            ],
            threshold: 2,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_empty_members() {
        let settings = Settings {
            index: 0,
            members: vec![],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_zero_threshold() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::Member,
                false,
            )],
            threshold: 0,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_duplicate_member() {
        let member = mk_ed25519_member(
            1,
            vec![
                Permission::InitiateTransaction,
                Permission::VoteTransaction,
                Permission::ExecuteTransaction,
            ],
            UserRole::Member,
            false,
        );
        let settings = Settings {
            index: 0,
            members: vec![member, member],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_threshold_exceeds_voters() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::Member,
                false,
            )],
            threshold: 2,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_no_initiator() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![Permission::VoteTransaction, Permission::ExecuteTransaction],
                UserRole::Member,
                false,
            )],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_no_executor() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![Permission::InitiateTransaction, Permission::VoteTransaction],
                UserRole::Member,
                false,
            )],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_permanent_member_without_delegate() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::PermanentMember,
                false,
            )],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_permanent_member_valid() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::PermanentMember,
                true,
            )],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_transaction_manager_wrong_permissions() {
        let settings = Settings {
            index: 0,
            members: vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::TransactionManager,
                false,
            )],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_transaction_manager_valid() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    1,
                    vec![Permission::InitiateTransaction],
                    UserRole::TransactionManager,
                    false,
                ),
                mk_ed25519_member(
                    2,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_transaction_manager_is_delegate_fails() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    1,
                    vec![Permission::InitiateTransaction],
                    UserRole::TransactionManager,
                    true,
                ),
                mk_ed25519_member(
                    2,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_transaction_manager_secp256r1_fails() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_secp256r1_member(
                    1,
                    vec![Permission::InitiateTransaction],
                    UserRole::TransactionManager,
                ),
                mk_ed25519_member(
                    2,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_administrator_valid() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    1,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Administrator,
                    false,
                ),
                mk_ed25519_member(
                    2,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_administrator_secp256r1_fails() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_secp256r1_member(
                    1,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Administrator,
                ),
                mk_ed25519_member(
                    2,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_two_permanent_members_fails() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    1,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::PermanentMember,
                    true,
                ),
                mk_ed25519_member(
                    2,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::PermanentMember,
                    true,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_two_transaction_managers_fails() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    1,
                    vec![Permission::InitiateTransaction],
                    UserRole::TransactionManager,
                    false,
                ),
                mk_ed25519_member(
                    2,
                    vec![Permission::InitiateTransaction],
                    UserRole::TransactionManager,
                    false,
                ),
                mk_ed25519_member(
                    3,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_two_administrators_fails() {
        let settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    1,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Administrator,
                    false,
                ),
                mk_ed25519_member(
                    2,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Administrator,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_sort_members() {
        let mut settings = Settings {
            index: 0,
            members: vec![
                mk_ed25519_member(
                    3,
                    vec![Permission::InitiateTransaction, Permission::VoteTransaction],
                    UserRole::Member,
                    false,
                ),
                mk_ed25519_member(
                    1,
                    vec![Permission::InitiateTransaction],
                    UserRole::TransactionManager,
                    false,
                ),
            ],
            threshold: 1,
            multi_wallet_bump: 0,
            bump: 0,
            settings_address_tree_index: 0,
            latest_slot_number: 0,
        };
        settings.sort_members().unwrap();
        assert_eq!(
            settings.members[0].role,
            UserRole::TransactionManager.to_u8()
        );
        assert_eq!(settings.members[1].role, UserRole::Member.to_u8());
    }
}

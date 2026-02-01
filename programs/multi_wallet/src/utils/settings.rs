use crate::{
    state::UserReadOnlyOrMutateArgs,
    utils::{bool_to_u8_delegate, UserRole},
    AddMemberArgs, EditMemberArgs, KeyType, Member, MemberKey, MultisigError, Permission,
    PermissionCounts, RemoveMemberArgs,
};
use anchor_lang::prelude::*;
use std::collections::{HashMap, HashSet};

pub const MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS: usize = 4;

pub trait MultisigSettings {
    fn set_threshold(&mut self, value: u8) -> Result<()>;
    fn extend_members(&mut self, members: Vec<Member>) -> Result<()>;
    fn delete_members(&mut self, members: Vec<MemberKey>) -> Result<()>;
    fn set_latest_slot_number(&mut self, value: u64) -> Result<()>;
    fn get_threshold(&self) -> Result<u8>;
    fn get_members(&self) -> Result<&[Member]>;
    fn get_members_mut(&mut self) -> Result<&mut [Member]>;
    fn get_latest_slot_number(&self) -> Result<u64>;
    fn is_compressed(&self) -> Result<bool>;

    fn sort_members(&mut self) -> Result<()> {
        self.get_members_mut()?.sort_by_key(|m| m.role);
        Ok(())
    }

    fn latest_slot_number_check(
        &mut self,
        slot_numbers: &[u64],
        sysvar_slot_history: &Option<UncheckedAccount>,
    ) -> Result<()> {
        if !slot_numbers.is_empty() {
            let min_slot_number = slot_numbers
                .iter()
                .min()
                .ok_or(MultisigError::EmptySlotNumbers)?;
            let max_slot_number = slot_numbers
                .iter()
                .max()
                .ok_or(MultisigError::EmptySlotNumbers)?;
            let sysvar_slot_history = sysvar_slot_history
                .as_ref()
                .ok_or(MultisigError::MissingSysvarSlotHistory)?;

            let data = sysvar_slot_history
                .try_borrow_data()
                .map_err(|_| MultisigError::InvalidSysvarDataFormat)?;

            let num_slot_hashes = u64::from_le_bytes(
                data[..8]
                    .try_into()
                    .map_err(|_| MultisigError::InvalidSysvarDataFormat)?,
            );

            let first_slot = u64::from_le_bytes(
                data[8..16]
                    .try_into()
                    .map_err(|_| MultisigError::InvalidSysvarDataFormat)?,
            );

            // Validate slot number ordering: max_slot_number must be <= first_slot
            let offset = first_slot
                .checked_sub(*max_slot_number)
                .ok_or(MultisigError::SlotNumberNotFound)? as usize;

            // Validate offset is within bounds
            if offset >= num_slot_hashes as usize {
                return err!(MultisigError::SlotNumberNotFound);
            }

            // Validate slot numbers are in the future relative to latest_slot_number
            require!(
                self.get_latest_slot_number()? < *min_slot_number,
                MultisigError::InvalidSlotNumber
            );

            self.set_latest_slot_number(*max_slot_number)?;
        }

        Ok(())
    }

    fn invariant(&self) -> Result<()> {
        let members = self.get_members()?;
        let member_count = members.len();
        let threshold = self.get_threshold()?;
        require!(member_count > 0, MultisigError::EmptyMembers);
        if self.is_compressed()? {
            require!(
                member_count <= MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS,
                MultisigError::TooManyMembers
            );
        }
        require!(threshold > 0, MultisigError::InvalidThreshold);

        let mut seen: HashSet<MemberKey> = HashSet::with_capacity(member_count);
        let mut permission_counts = PermissionCounts::default();

        for member in members {
            if !seen.insert(member.pubkey) {
                return Err(MultisigError::DuplicateMember.into());
            }
            let p = &member.permissions;
            if p.has(Permission::VoteTransaction) {
                permission_counts.voters += 1
            }
            if p.has(Permission::InitiateTransaction) {
                permission_counts.initiators += 1;
            }
            if p.has(Permission::ExecuteTransaction) {
                permission_counts.executors += 1;
            }

            let role = UserRole::from(member.role);

            match role {
                UserRole::PermanentMember => {
                    permission_counts.permanent_members += 1;
                    require!(
                        member.is_delegate == 1,
                        MultisigError::InvalidPermanentMemberConfig
                    );
                }
                UserRole::TransactionManager => {
                    permission_counts.transaction_manager += 1;

                    // must be initiator only (no vote/execute)
                    require!(
                        p.has(Permission::InitiateTransaction)
                            && !p.has(Permission::VoteTransaction)
                            && !p.has(Permission::ExecuteTransaction),
                        MultisigError::InvalidTransactionManagerPermission
                    );

                    require!(
                        member.is_delegate == 0,
                        MultisigError::InvalidTransactionManagerConfig
                    );
                    require!(
                        member.pubkey.get_type() == KeyType::Ed25519,
                        MultisigError::InvalidTransactionManagerConfig
                    );
                }
                UserRole::Administrator => {
                    permission_counts.administrator += 1;
                    require!(
                        member.pubkey.get_type() == KeyType::Ed25519,
                        MultisigError::InvalidAdministratorConfig
                    );
                    require!(
                        member.is_delegate == 0,
                        MultisigError::InvalidAdministratorConfig
                    );
                }
                _ => {}
            }
        }

        require!(
            permission_counts.permanent_members <= 1,
            MultisigError::OnlyOnePermanentMemberAllowed
        );

        require!(
            permission_counts.transaction_manager <= 1,
            MultisigError::OnlyOneTransactionManagerAllowed
        );

        require!(
            permission_counts.administrator <= 1,
            MultisigError::OnlyOneAdministratorAllowed
        );

        require!(
            threshold as usize <= permission_counts.voters,
            MultisigError::InsufficientSignersWithVotePermission
        );

        require!(
            permission_counts.initiators >= 1,
            MultisigError::InsufficientSignerWithInitiatePermission
        );

        require!(
            permission_counts.executors >= 1,
            MultisigError::InsufficientSignerWithExecutePermission
        );

        Ok(())
    }

    fn set_members(&mut self, members: Vec<Member>) -> Result<()> {
        let exisiting_members = self.get_members()?.iter().map(|f| f.pubkey).collect();
        self.delete_members(exisiting_members)?;
        self.extend_members(members)?;
        self.sort_members()?;
        Ok(())
    }

    fn add_members<'a>(&mut self, new_members: Vec<AddMemberArgs>) -> Result<Vec<AddMemberArgs>> {
        let new_member_data = new_members
            .iter()
            .map(|member| {
                let data = match &member.user_args {
                    UserReadOnlyOrMutateArgs::Read(user_read_only_args) => {
                        &user_read_only_args.data
                    }
                    UserReadOnlyOrMutateArgs::Mutate(user_mut_args) => &user_mut_args.data,
                };
                Member {
                    pubkey: member.member_key,
                    permissions: member.permissions,
                    role: data.role.to_u8(),
                    user_address_tree_index: data.user_address_tree_index,
                    is_delegate: bool_to_u8_delegate(false),
                }
            })
            .collect::<Vec<_>>();

        self.extend_members(new_member_data)?;
        self.sort_members()?;

        Ok(new_members)
    }

    fn remove_members(
        &mut self,
        member_pubkeys: Vec<RemoveMemberArgs>,
    ) -> Result<Vec<RemoveMemberArgs>> {
        let keys_to_delete: Vec<MemberKey> = member_pubkeys.iter().map(|f| f.member_key).collect();

        self.delete_members(keys_to_delete)?;
        self.sort_members()?;

        Ok(member_pubkeys)
    }

    fn edit_permissions(&mut self, new_members: Vec<EditMemberArgs>) -> Result<()> {
        let members = self.get_members_mut()?;

        let mut idx: HashMap<MemberKey, usize> = HashMap::with_capacity(members.len());
        for (i, m) in members.iter().enumerate() {
            idx.insert(m.pubkey, i);
        }

        for nm in new_members {
            let i = *idx
                .get(&nm.member_key)
                .ok_or(MultisigError::MemberNotFound)?;

            require!(
                UserRole::from(members[i].role) != UserRole::TransactionManager,
                MultisigError::InvalidTransactionManagerPermission
            );

            members[i].permissions = nm.permissions;
        }

        self.sort_members()?;

        Ok(())
    }
}

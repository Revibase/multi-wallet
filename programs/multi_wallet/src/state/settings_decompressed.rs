use crate::{
    error::MultisigError, AddMemberArgs, EditMemberArgs, Member, MemberKey, MultisigSettings,
    RemoveMemberArgs, SEED_MULTISIG,
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

    pub fn invariant(&mut self) -> Result<()> {
        MultisigSettings::invariant(self)
    }

    pub fn latest_slot_number_check(
        &mut self,
        slot_numbers: &[u64],
        sysvar_slot_history: &Option<UncheckedAccount>,
    ) -> Result<()> {
        MultisigSettings::latest_slot_number_check(self, slot_numbers, sysvar_slot_history)
    }

    pub fn get_settings_key_from_index(index: u128, bump: u8) -> Result<Pubkey> {
        let index_bytes = index.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[SEED_MULTISIG, index_bytes.as_ref(), &[bump]];
        let pubkey =
            Pubkey::create_program_address(signer_seeds, &crate::ID).map_err(ProgramError::from)?;
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

    fn get_members(&self) -> Result<Vec<Member>> {
        Ok(self.members.to_vec())
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

    fn set_members(&mut self, members: Vec<Member>) -> Result<()> {
        self.members = members;
        Ok(())
    }
}

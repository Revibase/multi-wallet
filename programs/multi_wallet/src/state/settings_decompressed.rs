use crate::{
    AddMemberArgs, EditMemberArgs, Member, MemberKey, MultisigSettings, RemoveMemberArgs,
    MAXIMUM_AMOUNT_OF_MEMBERS, SEED_MULTISIG,
};
use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct Settings {
    pub index: u128,
    pub members: [Member; MAXIMUM_AMOUNT_OF_MEMBERS],
    pub members_len: u8,
    pub threshold: u8,
    pub multi_wallet_bump: u8,
    pub bump: u8,
    pub settings_address_tree_index: u8,
    pub _padding: [u8; 7],
}

impl Settings {
    pub fn size() -> usize {
        8  + // anchor account discriminator
        16  + // index
        MAXIMUM_AMOUNT_OF_MEMBERS * Member::INIT_SPACE +// members
        1 +  // members len
        1  + // threshold
        1  + // multi_wallet bump
        1  + // settings bump
        1  + // settings_address_tree_index
        11 // unused padding
    }
    pub fn edit_permissions(
        &mut self,
        members: Vec<EditMemberArgs>,
    ) -> Result<(Vec<AddMemberArgs>, Vec<RemoveMemberArgs>)> {
        MultisigSettings::edit_permissions(self, members)
    }
    pub fn add_members<'a>(
        &mut self,
        settings: &Pubkey,
        new_members: Vec<AddMemberArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: Option<&UncheckedAccount<'a>>,
    ) -> Result<Vec<AddMemberArgs>> {
        MultisigSettings::add_members(
            self,
            settings,
            new_members,
            remaining_accounts,
            sysvar_slot_history,
            instructions_sysvar,
        )
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

    pub fn get_settings_key_from_index(index: u128, bump: u8) -> Result<Pubkey> {
        let index_bytes = index.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[SEED_MULTISIG, index_bytes.as_ref(), &[bump]];
        let pubkey =
            Pubkey::create_program_address(signer_seeds, &crate::ID).map_err(ProgramError::from)?;
        Ok(pubkey)
    }
}

impl MultisigSettings for Settings {
    fn set_threshold(&mut self, value: u8) -> Result<()> {
        self.threshold = value;
        Ok(())
    }

    fn get_threshold(&self) -> Result<u8> {
        Ok(self.threshold)
    }

    fn get_members(&self) -> Result<Vec<Member>> {
        Ok(self.members[0..self.members_len as usize].to_vec())
    }

    fn extend_members(&mut self, members: Vec<Member>) -> Result<()> {
        for member in members {
            self.members[self.members_len as usize] = member;
            self.members_len += 1;
        }
        Ok(())
    }

    fn delete_members(&mut self, members: Vec<MemberKey>) -> Result<()> {
        for member in members {
            if let Some(pos) = self.members[0..self.members_len as usize]
                .iter()
                .position(|m| m.pubkey.eq(&member))
            {
                // Shift everything left from pos
                for i in pos..(self.members_len - 1) as usize {
                    self.members[i] = self.members[i + 1];
                }
                // Fill last item with default value
                self.members[(self.members_len - 1) as usize] = Member::default();
                self.members_len -= 1;
            }
        }
        Ok(())
    }

    fn set_members(&mut self, members: Vec<Member>) -> Result<()> {
        for (index, member) in members.iter().enumerate() {
            self.members[index] = *member;
        }
        for i in members.len()..MAXIMUM_AMOUNT_OF_MEMBERS {
            self.members[i] = Member::default();
        }
        self.members_len = members.len() as u8;
        Ok(())
    }
}

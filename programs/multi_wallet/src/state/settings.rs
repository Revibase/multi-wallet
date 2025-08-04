use super::{
    DomainConfig, MemberKeyWithPermissionsArgs, MemberWithCreationArgs, TransactionActionType,
};
use crate::error::MultisigError;
use crate::id;
use crate::state::member::{Member, MemberKey};
use crate::state::{
    ChallengeArgs, KeyType, MemberKeyWithCloseArgs, Permission, PermissionCounts,
    SEED_DOMAIN_CONFIG, SEED_MULTISIG,
};
use anchor_lang::prelude::*;
use std::collections::{HashMap, HashSet};

pub const MAXIMUM_AMOUNT_OF_MEMBERS: usize = 4;

#[account(zero_copy)]
pub struct Settings {
    pub index: u128,
    pub members: [Member; MAXIMUM_AMOUNT_OF_MEMBERS],
    pub members_len: u8,
    pub threshold: u8,
    pub multi_wallet_bump: u8,
    pub bump: u8,
}

impl Settings {
    pub fn size() -> usize {
        8  + // anchor account discriminator
        16  + // index
        MAXIMUM_AMOUNT_OF_MEMBERS * Member::INIT_SPACE +// members
        1 +  // members len
        1  + // threshold
        1  + // multi_wallet bump
        1 // settings bump
    }
    pub fn edit_permissions(
        &mut self,
        members: Vec<MemberKeyWithPermissionsArgs>,
    ) -> Result<(
        Vec<MemberKeyWithPermissionsArgs>,
        Vec<MemberKeyWithPermissionsArgs>,
    )> {
        MultisigSettings::edit_permissions(self, members)
    }
    pub fn add_members<'a>(
        &mut self,
        settings: &Pubkey,
        new_members: Vec<MemberWithCreationArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: Option<&UncheckedAccount<'a>>,
    ) -> Result<Vec<MemberWithCreationArgs>> {
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
        member_pubkeys: Vec<MemberKeyWithCloseArgs>,
    ) -> Result<Vec<MemberKeyWithCloseArgs>> {
        MultisigSettings::remove_members(self, member_pubkeys)
    }

    pub fn invariant(&mut self) -> Result<()> {
        MultisigSettings::invariant(self)
    }

    pub fn get_settings_key_from_index(index: u128, bump: u8) -> Result<Pubkey> {
        let index_bytes = index.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[SEED_MULTISIG, index_bytes.as_ref(), &[bump]];
        let pubkey = Pubkey::create_program_address(signer_seeds, &crate::ID).unwrap();
        Ok(pubkey)
    }

    pub fn set_threshold(&mut self, value: u8) -> Result<()> {
        MultisigSettings::set_threshold(self, value)
    }

    pub fn set_members(&mut self, members: Vec<Member>) -> Result<()> {
        MultisigSettings::set_members(self, members)
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

pub trait MultisigSettings {
    fn set_threshold(&mut self, value: u8) -> Result<()>;
    fn set_members(&mut self, members: Vec<Member>) -> Result<()>;
    fn extend_members(&mut self, members: Vec<Member>) -> Result<()>;
    fn delete_members(&mut self, members: Vec<MemberKey>) -> Result<()>;
    fn get_threshold(&self) -> Result<u8>;
    fn get_members(&self) -> Result<Vec<Member>>;
    fn invariant(&self) -> Result<()> {
        let members = self.get_members().unwrap();
        let member_count = members.len();
        let threshold = self.get_threshold().unwrap();
        require!(member_count > 0, MultisigError::EmptyMembers);
        require!(
            member_count <= MAXIMUM_AMOUNT_OF_MEMBERS,
            MultisigError::TooManyMembers
        );
        require!(threshold > 0, MultisigError::InvalidThreshold);

        let mut seen: HashSet<MemberKey> = std::collections::HashSet::new();
        let mut permission_counts = PermissionCounts::default();

        for member in members {
            if !seen.insert(member.pubkey) {
                return Err(MultisigError::DuplicateMember.into());
            }
            let permissions = &member.permissions;
            if permissions.has(Permission::VoteTransaction) {
                permission_counts.voters += 1
            }
            if permissions.has(Permission::InitiateTransaction) {
                permission_counts.initiators += 1;
            }
            if permissions.has(Permission::ExecuteTransaction) {
                permission_counts.executors += 1;
            }
        }

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

    fn add_members<'a>(
        &mut self,
        settings: &Pubkey,
        new_members: Vec<MemberWithCreationArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: Option<&UncheckedAccount<'a>>,
    ) -> Result<Vec<MemberWithCreationArgs>> {
        let mut members_to_create_delegate_accounts = Vec::with_capacity(new_members.len());
        let mut new_member_data = Vec::with_capacity(new_members.len());

        for member_with_args in new_members.into_iter() {
            let member = &member_with_args.data;

            if member.pubkey.get_type() == KeyType::Secp256r1 {
                let (domain_config, rp_id_hash) =
                    Self::verify_domain_config(remaining_accounts, &member.domain_config)?;

                let secp256r1_verify_data = member_with_args
                    .verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                let instructions_sysvar =
                    instructions_sysvar.ok_or(MultisigError::MissingAccount)?;

                secp256r1_verify_data.verify_webauthn(
                    sysvar_slot_history,
                    &domain_config,
                    instructions_sysvar,
                    ChallengeArgs {
                        account: *settings,
                        message_hash: rp_id_hash,
                        action_type: TransactionActionType::AddNewMember,
                    },
                )?;
            }

            // Push the `Member` into a new list for appending
            new_member_data.push(member_with_args.data);

            // If it's a delegate, push the whole `MemberWithCreationArgs`
            if member.permissions.has(Permission::IsDelegate) {
                members_to_create_delegate_accounts.push(member_with_args);
            }
        }

        self.extend_members(new_member_data)?;

        Ok(members_to_create_delegate_accounts)
    }

    fn remove_members(
        &mut self,
        member_pubkeys: Vec<MemberKeyWithCloseArgs>,
    ) -> Result<Vec<MemberKeyWithCloseArgs>> {
        let members = self.get_members().unwrap();
        let mut members_to_close = Vec::with_capacity(member_pubkeys.len());
        let mut keys_to_delete = Vec::with_capacity(member_pubkeys.len());

        for m in member_pubkeys.into_iter() {
            let is_delegate = members.iter().any(|member| {
                member.pubkey == m.data && member.permissions.has(Permission::IsDelegate)
            });

            if is_delegate {
                members_to_close.push(m);
            } else {
                keys_to_delete.push(m.data);
            }
        }

        keys_to_delete.extend(members_to_close.iter().map(|m| m.data));

        self.delete_members(keys_to_delete)?;
        Ok(members_to_close)
    }

    fn edit_permissions(
        &mut self,
        new_members: Vec<MemberKeyWithPermissionsArgs>,
    ) -> Result<(
        Vec<MemberKeyWithPermissionsArgs>,
        Vec<MemberKeyWithPermissionsArgs>,
    )> {
        let mut members_to_close_delegate_account = vec![];
        let mut members_to_create_delegate_account = vec![];

        let mut current_members_map: HashMap<MemberKey, Member> = self
            .get_members()
            .unwrap()
            .into_iter()
            .map(|m| (m.pubkey, m))
            .collect();

        for member in new_members {
            let permission = member.permissions;
            let is_delegate = permission.has(Permission::IsDelegate);
            let pubkey = member.pubkey;

            match current_members_map.get(&pubkey) {
                Some(existing_member) => {
                    let is_currently_delegate =
                        existing_member.permissions.has(Permission::IsDelegate);

                    if is_delegate && !is_currently_delegate {
                        members_to_create_delegate_account.push(member);
                    } else if !is_delegate && is_currently_delegate {
                        members_to_close_delegate_account.push(member);
                    }
                }
                None => return err!(MultisigError::InvalidArguments),
            }

            current_members_map.insert(
                pubkey,
                Member {
                    pubkey,
                    permissions: permission,
                    domain_config: current_members_map
                        .get(&pubkey)
                        .map(|m| m.domain_config)
                        .unwrap_or_default(),
                },
            );
        }

        let updated_members: Vec<Member> = current_members_map.into_values().collect();

        self.set_members(updated_members)?;

        Ok((
            members_to_create_delegate_account,
            members_to_close_delegate_account,
        ))
    }

    fn verify_domain_config<'a>(
        remaining_accounts: &'a [AccountInfo<'a>],
        domain_config: &Pubkey,
    ) -> Result<(Option<AccountLoader<'a, DomainConfig>>, [u8; 32])> {
        require!(
            domain_config.ne(&Pubkey::default()),
            MultisigError::DomainConfigIsMissing
        );
        let domain_account = remaining_accounts
            .iter()
            .find(|f| f.key.eq(domain_config))
            .ok_or(MultisigError::MissingAccount)?;
        let account_loader = AccountLoader::<DomainConfig>::try_from(domain_account)
            .map_err(|_| MultisigError::DomainConfigIsMissing)?;
        let rp_id_hash = {
            let domain_data = account_loader.load()?;
            let seeds = &[
                SEED_DOMAIN_CONFIG,
                domain_data.rp_id_hash.as_ref(),
                &[domain_data.bump],
            ];

            let delegate_account = Pubkey::create_program_address(seeds, &id()).unwrap();

            require!(
                delegate_account == *domain_account.key,
                MultisigError::MemberDoesNotBelongToDomainConfig
            );

            domain_data.rp_id_hash
        };

        Ok((Some(account_loader), rp_id_hash))
    }
}

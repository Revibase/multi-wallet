use crate::{
    state::UserReadOnlyOrMutateArgs, utils::UserRole, AddMemberArgs, ChallengeArgs, DelegateOp,
    DomainConfig, EditMemberArgs, KeyType, Member, MemberKey, MultisigError, Permission,
    PermissionCounts, RemoveMemberArgs, TransactionActionType,
};
use anchor_lang::prelude::*;
use std::collections::{HashMap, HashSet};

pub const MAXIMUM_AMOUNT_OF_MEMBERS: usize = 4;

pub trait MultisigSettings {
    fn set_threshold(&mut self, value: u8) -> Result<()>;
    fn set_members(&mut self, members: Vec<Member>) -> Result<()>;
    fn extend_members(&mut self, members: Vec<Member>) -> Result<()>;
    fn delete_members(&mut self, members: Vec<MemberKey>) -> Result<()>;
    fn get_threshold(&self) -> Result<u8>;
    fn get_members(&self) -> Result<Vec<Member>>;
    fn invariant(&self) -> Result<()> {
        let members = self.get_members()?;
        let member_count = members.len();
        let threshold = self.get_threshold()?;
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
            if UserRole::from(member.role).eq(&UserRole::PermanentMember) {
                permission_counts.permanent_members += 1;
            }
            if UserRole::from(member.role).eq(&UserRole::TransactionManager) {
                permission_counts.transaction_manager += 1;
                require!(
                    p.has(Permission::InitiateTransaction),
                    MultisigError::TransactionManagerNotAllowed
                );
                require!(
                    !p.has(Permission::VoteTransaction),
                    MultisigError::TransactionManagerNotAllowed
                );
                require!(
                    !p.has(Permission::ExecuteTransaction),
                    MultisigError::TransactionManagerNotAllowed
                );
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
        new_members: Vec<AddMemberArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: Option<&UncheckedAccount<'a>>,
    ) -> Result<Vec<AddMemberArgs>> {
        let mut new_member_data = vec![];
        for member in &new_members {
            let (role, has_transaction_manager_url, user_address_tree_index) =
                match &member.user_args {
                    UserReadOnlyOrMutateArgs::Mutate(a) => (
                        a.data.role,
                        a.data.transaction_manager_url.is_some(),
                        a.data.user_address_tree_index,
                    ),
                    UserReadOnlyOrMutateArgs::Read(a) => (
                        a.data.role,
                        a.data.transaction_manager_url.is_some(),
                        a.data.user_address_tree_index,
                    ),
                };

            require!(
                match role {
                    UserRole::PermanentMember => member.delegate_operation.eq(&DelegateOp::Add),

                    UserRole::TransactionManager =>
                        member.delegate_operation.eq(&DelegateOp::Ignore)
                            && has_transaction_manager_url,

                    UserRole::Administrator => member.delegate_operation.eq(&DelegateOp::Ignore),

                    UserRole::Member => member.delegate_operation.ne(&DelegateOp::Remove),
                },
                MultisigError::InvalidAccount
            );

            new_member_data.push(Member {
                pubkey: member.member_key,
                permissions: member.permissions,
                role: role.to_u8(),
                user_address_tree_index,
            });

            match member.member_key.get_type() {
                KeyType::Ed25519 => {
                    if member.delegate_operation.eq(&DelegateOp::Add) {
                        let expected_seed = member.member_key.get_seed()?;
                        let has_signer = remaining_accounts
                            .iter()
                            .any(|f| f.is_signer && f.key.to_bytes().eq(&expected_seed));
                        require!(has_signer, MultisigError::NoSignerFound);
                    }
                }
                KeyType::Secp256r1 => {
                    let domain_config_key = match &member.user_args {
                        UserReadOnlyOrMutateArgs::Mutate(user_mut_args) => user_mut_args
                            .data
                            .domain_config
                            .ok_or(MultisigError::DomainConfigIsMissing)?,
                        UserReadOnlyOrMutateArgs::Read(user_readonly_args) => user_readonly_args
                            .data
                            .domain_config
                            .ok_or(MultisigError::DomainConfigIsMissing)?,
                    };
                    let domain_config = DomainConfig::extract_domain_config_account(
                        remaining_accounts,
                        domain_config_key,
                    )?;
                    let rp_id_hash = domain_config.load()?.rp_id_hash;
                    let verify_data = member
                        .verify_args
                        .as_ref()
                        .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;
                    let instructions_sysvar =
                        instructions_sysvar.ok_or(MultisigError::MissingAccount)?;
                    verify_data.verify_webauthn(
                        sysvar_slot_history,
                        &Some(domain_config),
                        instructions_sysvar,
                        ChallengeArgs {
                            account: *settings,
                            message_hash: rp_id_hash,
                            action_type: TransactionActionType::AddNewMember,
                        },
                    )?;
                }
            }
        }

        self.extend_members(new_member_data)?;

        Ok(new_members)
    }

    fn remove_members(
        &mut self,
        member_pubkeys: Vec<RemoveMemberArgs>,
    ) -> Result<Vec<RemoveMemberArgs>> {
        let members = self.get_members()?;

        if let Some(existing_perm_member) = members
            .iter()
            .find(|m| UserRole::from(m.role).eq(&UserRole::PermanentMember))
        {
            require!(
                !member_pubkeys
                    .iter()
                    .any(|f| f.member_key.eq(&existing_perm_member.pubkey)),
                MultisigError::PermanentMember
            );
        }

        let keys_to_delete = member_pubkeys.iter().map(|f| f.member_key).collect();

        self.delete_members(keys_to_delete)?;

        Ok(member_pubkeys)
    }

    fn edit_permissions(
        &mut self,
        new_members: Vec<EditMemberArgs>,
    ) -> Result<(Vec<AddMemberArgs>, Vec<RemoveMemberArgs>)> {
        let mut members_to_remove_delegate = Vec::new();
        let mut members_to_add_delegate = Vec::new();

        let mut current_members_map: HashMap<MemberKey, Member> = self
            .get_members()?
            .into_iter()
            .map(|m| (m.pubkey, m))
            .collect();

        for member in new_members {
            let pubkey = member.member_key;
            let existing_member = current_members_map
                .get_mut(&pubkey)
                .ok_or(MultisigError::InvalidArguments)?;

            require!(
                UserRole::from(existing_member.role).ne(&UserRole::TransactionManager),
                MultisigError::TransactionManagerNotAllowed
            );

            // update permissions in place
            existing_member.permissions = member.permissions;

            match member.delegate_operation {
                DelegateOp::Add | DelegateOp::Remove => {
                    let user_mut_args = member.user_args.ok_or(MultisigError::MissingUserArgs)?;

                    require!(
                        user_mut_args.data.role.eq(&UserRole::Member),
                        MultisigError::InvalidAccount
                    );

                    if member.delegate_operation == DelegateOp::Add {
                        members_to_add_delegate.push(AddMemberArgs {
                            member_key: pubkey,
                            permissions: member.permissions,
                            verify_args: None,
                            user_args: UserReadOnlyOrMutateArgs::Mutate(user_mut_args),
                            delegate_operation: member.delegate_operation,
                        });
                    } else {
                        members_to_remove_delegate.push(RemoveMemberArgs {
                            member_key: pubkey,
                            user_args: UserReadOnlyOrMutateArgs::Mutate(user_mut_args),
                        });
                    }
                }
                DelegateOp::Ignore => {}
            }
        }

        self.set_members(current_members_map.into_values().collect())?;

        Ok((members_to_add_delegate, members_to_remove_delegate))
    }
}

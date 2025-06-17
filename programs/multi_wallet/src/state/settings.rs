use crate::error::MultisigError;
use crate::id;
use crate::state::member::{Member, MemberKey};
use crate::state::{KeyType, Permission, SEED_DOMAIN_CONFIG};
use anchor_lang::prelude::*;
use std::collections::{HashMap, HashSet};

use super::{
    DomainConfig, MemberKeyWithPermissionsArgs, MemberWithVerifyArgs, Secp256r1Pubkey,
    TransactionActionType,
};

#[account]
pub struct Settings {
    pub threshold: u8,
    pub multi_wallet_bump: u8,
    pub bump: u8,
    pub create_key: Pubkey,
    pub members: Vec<Member>,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    EditPermissions(Vec<MemberKeyWithPermissionsArgs>),
    AddMembers(Vec<MemberWithVerifyArgs>),
    RemoveMembers(Vec<MemberKey>),
    SetThreshold(u8),
}

// Helper struct to track permission counts
#[derive(Default)]
struct PermissionCounts {
    voters: usize,
    initiators: usize,
    executors: usize,
}

impl Settings {
    pub fn size(members_length: usize) -> usize {
        8  + // anchor account discriminator
        1  + // threshold
        1  + // vault_bump
        1  + // bump
        32 + // create_key
        4  + // members vector length
        members_length * Member::INIT_SPACE // members
    }

    // Makes sure the multisig state is valid.
    // This must be called at the end of every instruction that modifies a Multisig account.
    pub fn invariant(&self) -> Result<()> {
        let member_count = self.members.len();
        let threshold = self.threshold;
        let members = self.members.as_slice();
        require!(member_count > 0, MultisigError::EmptyMembers);
        require!(
            member_count <= usize::from(u16::MAX),
            MultisigError::TooManyMembers
        );
        require!(threshold > 0, MultisigError::InvalidThreshold);

        let mut seen: HashSet<&MemberKey> = std::collections::HashSet::new();
        let mut permission_counts = PermissionCounts::default();
        let mut has_secp256r1_key_voter = false;

        for member in members {
            // Check for duplicate public keys
            if !seen.insert(&member.pubkey) {
                return Err(MultisigError::DuplicateMember.into());
            }

            // Count permissions
            let permissions = &member.permissions;

            if permissions.has(Permission::VoteTransaction) {
                if member.pubkey.get_type().eq(&KeyType::Secp256r1) {
                    if !has_secp256r1_key_voter {
                        permission_counts.voters += 1;
                    }
                    has_secp256r1_key_voter = true;
                } else {
                    permission_counts.voters += 1;
                }
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

        // Ensure at least one member can initiate and execute transactions
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

    /// Add `new_member` to the multisig `members` vec.
    pub fn add_members<'a>(
        &mut self,
        settings: &Pubkey,
        new_members: Vec<MemberWithVerifyArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: &Option<UncheckedAccount<'a>>,
    ) -> Result<Vec<MemberKey>> {
        let mut members_to_create_delegate_account: Vec<MemberKey> = vec![];

        for member in &new_members {
            if member.data.pubkey.get_type().eq(&super::KeyType::Secp256r1) {
                let (domain_config, rp_id_hash) =
                    verify_domain_config(remaining_accounts, &member.data.domain_config)?;

                let secp256r1_verify_data = member
                    .verify_args
                    .as_ref()
                    .ok_or(MultisigError::InvalidSecp256r1VerifyArg)?;

                Secp256r1Pubkey::verify_webauthn(
                    secp256r1_verify_data,
                    sysvar_slot_history,
                    &domain_config,
                    settings,
                    &rp_id_hash,
                    TransactionActionType::AddNewMember,
                    instructions_sysvar,
                )?;
            }

            if member.data.permissions.has(Permission::IsDelegate) {
                members_to_create_delegate_account.push(member.data.pubkey);
            }
        }

        self.members
            .extend(new_members.iter().map(|f| f.data).collect::<Vec<Member>>());
        Ok(members_to_create_delegate_account)
    }

    /// Remove `member_pubkeys` from the multisig `members` vec.
    pub fn remove_members<'a>(&mut self, member_pubkeys: Vec<MemberKey>) -> Result<Vec<MemberKey>> {
        let members_to_close_delegate_account = self
            .members
            .iter()
            .filter(|f| {
                f.permissions.has(Permission::IsDelegate) && member_pubkeys.contains(&f.pubkey)
            })
            .map(|f| f.pubkey)
            .collect::<Vec<MemberKey>>();

        let set: HashSet<_> = member_pubkeys.iter().collect();
        self.members.retain(|x| !set.contains(&x.pubkey));
        Ok(members_to_close_delegate_account)
    }

    pub fn edit_permissions(&mut self, members: Vec<MemberKeyWithPermissionsArgs>) {
        let new_keys: HashMap<_, _> = members
            .into_iter()
            .map(|m| (m.pubkey, m.permissions))
            .collect();

        self.members = self
            .members
            .iter()
            .map(|m| {
                if let Some(&new_permissions) = new_keys.get(&m.pubkey) {
                    Member {
                        pubkey: m.pubkey,
                        permissions: new_permissions,
                        domain_config: m.domain_config,
                    }
                } else {
                    *m
                }
            })
            .collect();
    }

    /// Sets the threshold of an existing multi-wallet.
    pub fn set_threshold(&mut self, new_threshold: u8) {
        self.threshold = new_threshold;
    }
}
fn verify_domain_config<'a>(
    remaining_accounts: &'a [AccountInfo<'a>],
    domain_config: &Option<Pubkey>,
) -> Result<(Option<AccountLoader<'a, DomainConfig>>, [u8; 32])> {
    let expected_domain_config = domain_config.ok_or(MultisigError::DomainConfigIsMissing)?;

    let domain_account = remaining_accounts
        .iter()
        .find(|f| f.key.eq(&expected_domain_config))
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

use crate::error::MultisigError;
use crate::id;
use crate::state::member::{Member, MemberKey};
use crate::state::{Delegate, Permission, SEED_DELEGATE};
use crate::utils::{close, create_account_if_none_exist};
use anchor_lang::prelude::*;
use std::collections::HashSet;

use super::{SEED_MULTISIG, SEED_VAULT};

#[account]
pub struct Settings {
    pub create_key: Pubkey,
    pub threshold: u8,
    pub multi_wallet_bump: u8,
    pub bump: u8,
    pub metadata: Option<Pubkey>,
    pub members: Vec<Member>,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    SetMembers(Vec<Member>),
    AddMembers(Vec<Member>),
    RemoveMembers(Vec<MemberKey>),
    SetThreshold(u8),
    SetMetadata(Option<Pubkey>),
}

// Helper struct to track permission counts
#[derive(Default)]
struct PermissionCounts {
    voters: usize,
    initiators: usize,
    executors: usize,
    delegators: usize,
}

impl Settings {
    pub fn size(members_length: usize) -> usize {
        8  + // anchor account discriminator
        32 + // create key
        1  + // threshold
        1  + // bump
        1  + // vault_bump
        1  + // option
        32 + // metadata
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
        require!(
            threshold as usize <= member_count,
            MultisigError::InvalidThreshold
        );

        let mut seen: HashSet<&MemberKey> = std::collections::HashSet::new();
        let mut permission_counts = PermissionCounts::default();

        for member in members {
            // Check for duplicate public keys
            if !seen.insert(&member.pubkey) {
                return Err(MultisigError::DuplicateMember.into());
            }

            //validate member is of correct type
            member.pubkey.validate_type()?;

            // Count permissions
            let permissions = &member.permissions;
            if permissions.has(Permission::VoteTransaction) {
                permission_counts.voters += 1;
            }
            if permissions.has(Permission::InitiateTransaction) {
                permission_counts.initiators += 1;
            }
            if permissions.has(Permission::ExecuteTransaction) {
                permission_counts.executors += 1;
            }
            if permissions.has(Permission::IsDelegate) {
                permission_counts.delegators += 1;
            }
        }

        require!(
            threshold as usize <= permission_counts.voters,
            MultisigError::InsufficientSignersWithVotePermission
        );

        // Ensure at least one delegate
        require!(
            permission_counts.delegators >= 1,
            MultisigError::InsufficientSignerWithIsDelegatePermission
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
        new_members: Vec<Member>,
        remaining_accounts: &[AccountInfo<'a>],
        payer: &Signer<'a>,
        system_program: &Program<'a, System>,
    ) -> Result<()> {
        let multi_wallet_settings = Pubkey::create_program_address(
            &[SEED_MULTISIG, self.create_key.as_ref(), &[self.bump]],
            &id(),
        )
        .unwrap();
        let multi_wallet = Pubkey::create_program_address(
            &[
                SEED_MULTISIG,
                multi_wallet_settings.key().as_ref(),
                SEED_VAULT,
                &[self.multi_wallet_bump],
            ],
            &id(),
        )
        .unwrap();
        for member in &new_members {
            if member.permissions.has(Permission::IsDelegate) {
                create_delegate_account(
                    remaining_accounts,
                    payer,
                    system_program,
                    multi_wallet_settings,
                    multi_wallet,
                    member,
                )?;
            }
        }

        self.members.extend(new_members);
        Ok(())
    }

    /// Remove `member_pubkeys` from the multisig `members` vec.
    pub fn remove_members<'a>(
        &mut self,
        member_pubkeys: Vec<MemberKey>,
        remaining_accounts: &[AccountInfo<'a>],
        payer: &Signer<'a>,
    ) -> Result<()> {
        for member_pubkey in &member_pubkeys {
            let member = self.members.iter().find(|f| f.pubkey.eq(member_pubkey));
            if member.is_some() && member.unwrap().permissions.has(Permission::IsDelegate) {
                close_delegate_account(remaining_accounts, payer, member.unwrap())?;
            }
        }
        let set: HashSet<_> = member_pubkeys.iter().collect();
        self.members.retain(|x| !set.contains(&x.pubkey));
        Ok(())
    }

    /// set `new_members` as the multisig `members` vec.
    pub fn set_members<'a>(
        &mut self,
        new_members: Vec<Member>,
        remaining_accounts: &[AccountInfo<'a>],
        payer: &Signer<'a>,
        system_program: &Program<'a, System>,
    ) -> Result<()> {
        let multi_wallet_settings = Pubkey::create_program_address(
            &[SEED_MULTISIG, self.create_key.as_ref(), &[self.bump]],
            &id(),
        )
        .unwrap();
        let multi_wallet = Pubkey::create_program_address(
            &[
                SEED_MULTISIG,
                multi_wallet_settings.key().as_ref(),
                SEED_VAULT,
                &[self.multi_wallet_bump],
            ],
            &id(),
        )
        .unwrap();
        let members_to_create_account = new_members
            .iter()
            .filter(|f| !self.members.contains(f) && f.permissions.has(Permission::IsDelegate))
            .cloned()
            .collect::<Vec<Member>>();
        let members_to_close_account = self
            .members
            .iter()
            .filter(|f| !new_members.contains(f) && f.permissions.has(Permission::IsDelegate))
            .cloned()
            .collect::<Vec<Member>>();

        for member in &members_to_create_account {
            create_delegate_account(
                remaining_accounts,
                payer,
                system_program,
                multi_wallet_settings,
                multi_wallet,
                member,
            )?;
        }

        for member in &members_to_close_account {
            close_delegate_account(remaining_accounts, payer, member)?;
        }

        self.members = new_members;
        Ok(())
    }

    /// Sets the threshold of an existing multi-wallet.
    pub fn set_threshold(&mut self, new_threshold: u8) {
        self.threshold = new_threshold;
    }

    /// Sets the metadata of an existing multi-wallet.
    pub fn set_metadata(&mut self, metadata: Option<Pubkey>) {
        self.metadata = metadata;
    }
}

fn close_delegate_account<'a>(
    remaining_accounts: &[AccountInfo<'a>],
    payer: &Signer<'a>,
    member: &Member,
) -> Result<()> {
    let seeds = &[SEED_DELEGATE, member.pubkey.get_seed()];
    let (delegate_account, _) = Pubkey::find_program_address(seeds, &id());
    let new_account = remaining_accounts
        .iter()
        .find(|f| f.key.eq(&delegate_account));
    require!(new_account.is_some(), MultisigError::MissingAccount);
    require!(
        new_account.unwrap().is_writable,
        MultisigError::InvalidAccount
    );
    close(
        new_account.as_ref().unwrap().to_account_info(),
        payer.to_account_info(),
    )?;
    Ok(())
}

fn create_delegate_account<'a>(
    remaining_accounts: &[AccountInfo<'a>],
    payer: &Signer<'a>,
    system_program: &Program<'a, System>,
    multi_wallet_settings: Pubkey,
    multi_wallet: Pubkey,
    member: &Member,
) -> Result<()> {
    let seeds = &[SEED_DELEGATE, member.pubkey.get_seed()];
    let (delegate_account, bump) = Pubkey::find_program_address(seeds, &id());
    let new_account = remaining_accounts
        .iter()
        .find(|f| f.key.eq(&delegate_account));
    require!(new_account.is_some(), MultisigError::MissingAccount);
    require!(
        new_account.unwrap().is_writable,
        MultisigError::InvalidAccount
    );
    create_account_if_none_exist(
        &payer.to_account_info(),
        new_account.unwrap(),
        &system_program.to_account_info(),
        &id(),
        Delegate::size(),
        &[SEED_DELEGATE, member.pubkey.get_seed(), &[bump]],
    )?;
    let mut data = new_account.unwrap().try_borrow_mut_data()?;
    data[..8].copy_from_slice(Delegate::DISCRIMINATOR);
    data[8..40].copy_from_slice(&multi_wallet_settings.to_bytes());
    data[40..72].copy_from_slice(&multi_wallet.to_bytes());
    data[72] = bump;
    Ok(())
}

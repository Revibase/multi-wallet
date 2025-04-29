use crate::error::MultisigError;
use crate::id;
use crate::state::member::{Member, MemberKey};
use crate::state::{Delegate, KeyType, Permission, SEED_DELEGATE, SEED_DOMAIN_CONFIG};
use crate::utils::{close, create_account_if_none_exist};
use anchor_lang::prelude::*;
use std::collections::HashSet;

use super::{
    DomainConfig, MemberWithVerifyArgs, Secp256r1Pubkey, TransactionActionType, SEED_MULTISIG,
    SEED_VAULT,
};

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
    SetMembers(Vec<MemberWithVerifyArgs>),
    AddMembers(Vec<MemberWithVerifyArgs>),
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

        let mut seen: HashSet<&MemberKey> = std::collections::HashSet::new();
        let mut permission_counts = PermissionCounts::default();
        let mut is_secp256r1_key_voter = false;

        for member in members {
            // Check for duplicate public keys
            if !seen.insert(&member.pubkey) {
                return Err(MultisigError::DuplicateMember.into());
            }

            // Count permissions
            let permissions = &member.permissions;
            if permissions.has(Permission::VoteTransaction) && !is_secp256r1_key_voter {
                if member.pubkey.get_type().eq(&KeyType::Secp256r1) {
                    is_secp256r1_key_voter = true;
                }
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
        settings: &Pubkey,
        multi_wallet: &Pubkey,
        new_members: Vec<MemberWithVerifyArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        payer: &Signer<'a>,
        system_program: &Program<'a, System>,
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
    ) -> Result<()> {
        for member in &new_members {
            if member.data.pubkey.get_type().eq(&super::KeyType::Secp256r1) {
                let (domain_config, rp_id_hash) =
                    verify_domain_config(remaining_accounts, &member.data.metadata)?;
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
                )?;
            }

            if member.data.permissions.has(Permission::IsDelegate) {
                create_delegate_account(
                    remaining_accounts,
                    payer,
                    system_program,
                    settings,
                    multi_wallet,
                    &member.data.pubkey,
                )?;
            }
        }

        self.members
            .extend(new_members.iter().map(|f| f.data).collect::<Vec<Member>>());
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
        settings: &Pubkey,
        new_members: Vec<MemberWithVerifyArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        payer: &Signer<'a>,
        system_program: &Program<'a, System>,
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
    ) -> Result<()> {
        let multi_wallet = Pubkey::create_program_address(
            &[
                SEED_MULTISIG,
                settings.key().as_ref(),
                SEED_VAULT,
                &[self.multi_wallet_bump],
            ],
            &id(),
        )
        .unwrap();
        let members_to_close_account: Vec<_> = self
            .members
            .iter()
            .filter(|f| f.permissions.has(Permission::IsDelegate))
            .filter(|f| {
                !new_members
                    .iter()
                    .any(|member| member.data.pubkey.eq(&f.pubkey))
            })
            .collect();

        for member in &new_members {
            if self
                .members
                .iter()
                .any(|f| f.pubkey.eq(&member.data.pubkey))
            {
                continue;
            }

            if member.data.pubkey.get_type().eq(&super::KeyType::Secp256r1) {
                let (domain_config, rp_id_hash) =
                    verify_domain_config(remaining_accounts, &member.data.metadata)?;
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
                )?;
            }

            if member.data.permissions.has(Permission::IsDelegate) {
                create_delegate_account(
                    remaining_accounts,
                    payer,
                    system_program,
                    settings,
                    &multi_wallet,
                    &member.data.pubkey,
                )?;
            }
        }

        for member in members_to_close_account {
            close_delegate_account(remaining_accounts, payer, member)?;
        }

        self.members = new_members.iter().map(|f| f.data).collect();
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
fn verify_domain_config<'a>(
    remaining_accounts: &'a [AccountInfo<'a>],
    metadata: &Option<Pubkey>,
) -> Result<(Option<AccountLoader<'a, DomainConfig>>, [u8; 32])> {
    let metadata_key = metadata.ok_or(MultisigError::MissingMetadata)?;

    let domain_account = remaining_accounts
        .iter()
        .find(|f| f.key.eq(&metadata_key))
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
    multi_wallet_settings: &Pubkey,
    multi_wallet: &Pubkey,
    member_key: &MemberKey,
) -> Result<()> {
    let seeds = &[SEED_DELEGATE, member_key.get_seed()];
    let (delegate_account, bump) = Pubkey::find_program_address(seeds, &id());
    let new_account = remaining_accounts
        .iter()
        .find(|f| f.key.eq(&delegate_account));
    require!(new_account.is_some(), MultisigError::MissingAccount);

    create_account_if_none_exist(
        &payer.to_account_info(),
        new_account.unwrap(),
        &system_program.to_account_info(),
        &id(),
        Delegate::size(),
        &[SEED_DELEGATE, member_key.get_seed(), &[bump]],
    )?;
    let mut data = new_account.unwrap().try_borrow_mut_data()?;
    data[..8].copy_from_slice(Delegate::DISCRIMINATOR);
    data[8..40].copy_from_slice(&multi_wallet_settings.to_bytes());
    data[40..72].copy_from_slice(&multi_wallet.to_bytes());
    data[72] = bump;
    Ok(())
}

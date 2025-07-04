use super::{
    DomainConfig, MemberKeyWithPermissionsArgs, MemberWithCreationArgs, Secp256r1Pubkey,
    TransactionActionType,
};
use crate::error::MultisigError;
use crate::id;
use crate::state::member::{Member, MemberKey};
use crate::state::{
    KeyType, MemberKeyWithCloseArgs, Permission, SEED_DOMAIN_CONFIG, SEED_MULTISIG,
};
use anchor_lang::prelude::*;
use light_compressed_account::compressed_account::CompressedAccount;
use light_compressed_account::instruction_data::data::NewAddressParamsPacked;
use light_compressed_account::instruction_data::with_account_info::CompressedAccountInfo;
use light_sdk::account::LightAccount;
use light_sdk::address::v1::derive_address;
use light_sdk::cpi::CpiAccounts;
use light_sdk::instruction::account_meta::{CompressedAccountMeta, CompressedAccountMetaClose};
use light_sdk::instruction::{PackedAddressTreeInfo, PackedMerkleContext};
use light_sdk::{LightDiscriminator, LightHasher};
use std::collections::{HashMap, HashSet};

#[account]
pub struct Settings {
    pub threshold: u8,
    pub multi_wallet_bump: u8,
    pub bump: u8,
    pub index: u128,
    pub members: Vec<Member>,
}

#[derive(
    Clone,
    Debug,
    Default,
    AnchorDeserialize,
    AnchorSerialize,
    LightDiscriminator,
    LightHasher,
    PartialEq,
)]
pub struct CompressedSettings {
    pub threshold: u8,
    pub bump: u8,
    pub index: u128,
    pub multi_wallet_bump: u8,
    #[hash]
    pub members: Vec<Member>,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    EditPermissions(Vec<MemberKeyWithPermissionsArgs>),
    AddMembers(Vec<MemberWithCreationArgs>),
    RemoveMembers(Vec<MemberKeyWithCloseArgs>),
    SetThreshold(u8),
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Copy)]
pub struct SettingsCreationArgs {
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq)]
pub struct SettingsCloseArgs {
    pub account_meta: CompressedAccountMetaClose,
    pub data: CompressedSettings,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq)]
pub struct SettingsMutArgs {
    pub account_meta: CompressedAccountMeta,
    pub data: CompressedSettings,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq)]
pub struct SettingsProofArgs {
    pub merkle_context: PackedMerkleContext,
    pub root_index: u16,
    pub account: CompressedAccount,
}

#[derive(Default)]
struct PermissionCounts {
    voters: usize,
    initiators: usize,
    executors: usize,
}

trait MultisigSettings {
    fn threshold(&mut self) -> &mut u8;
    fn members(&mut self) -> &mut Vec<Member>;
    fn invariant(&mut self) -> Result<()> {
        let member_count = self.members().len();
        let threshold = *self.threshold();
        let members = self.members().as_slice();
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
            if !seen.insert(&member.pubkey) {
                return Err(MultisigError::DuplicateMember.into());
            }

            let permissions = &member.permissions;

            if permissions.has(Permission::VoteTransaction) {
                match member.pubkey.get_type() {
                    KeyType::Secp256r1 => {
                        if !has_secp256r1_key_voter {
                            permission_counts.voters += 1;
                            has_secp256r1_key_voter = true;
                        }
                    }
                    _ => permission_counts.voters += 1,
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
        instructions_sysvar: &Option<UncheckedAccount<'a>>,
    ) -> Result<Vec<MemberWithCreationArgs>> {
        for member in &new_members {
            if member.data.pubkey.get_type().eq(&KeyType::Secp256r1) {
                let (domain_config, rp_id_hash) =
                    Self::verify_domain_config(remaining_accounts, &member.data.domain_config)?;

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
        }
        let members_to_create_delegate_accounts: Vec<MemberWithCreationArgs> = new_members
            .iter()
            .filter(|f| f.data.permissions.has(Permission::IsDelegate))
            .cloned()
            .collect();
        self.members()
            .extend(new_members.into_iter().map(|f| f.data));

        Ok(members_to_create_delegate_accounts)
    }

    fn remove_members<'a>(
        &mut self,
        member_pubkeys: Vec<MemberKeyWithCloseArgs>,
    ) -> Result<Vec<MemberKeyWithCloseArgs>> {
        let members_to_close_delegate_account: Vec<MemberKeyWithCloseArgs> = member_pubkeys
            .iter()
            .filter(|f| {
                self.members()
                    .iter()
                    .any(|m| m.pubkey == f.data && m.permissions.has(Permission::IsDelegate))
            })
            .cloned()
            .collect();

        self.members()
            .retain(|member| !member_pubkeys.iter().any(|f| f.data.eq(&member.pubkey)));

        Ok(members_to_close_delegate_account)
    }

    fn edit_permissions(&mut self, members: Vec<MemberKeyWithPermissionsArgs>) {
        let new_keys: HashMap<_, _> = members
            .into_iter()
            .map(|m| (m.pubkey, m.permissions))
            .collect();

        *self.members() = self
            .members()
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

    fn set_threshold(&mut self, new_threshold: u8) {
        *self.threshold() = new_threshold;
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
}

impl MultisigSettings for Settings {
    fn threshold(&mut self) -> &mut u8 {
        &mut self.threshold
    }
    fn members(&mut self) -> &mut Vec<Member> {
        &mut self.members
    }
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
    pub fn edit_permissions(&mut self, members: Vec<MemberKeyWithPermissionsArgs>) {
        MultisigSettings::edit_permissions(self, members)
    }
    pub fn add_members<'a>(
        &mut self,
        settings: &Pubkey,
        new_members: Vec<MemberWithCreationArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: &Option<UncheckedAccount<'a>>,
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
    pub fn set_threshold(&mut self, new_threshold: u8) {
        MultisigSettings::set_threshold(self, new_threshold)
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
}

impl MultisigSettings for CompressedSettings {
    fn threshold(&mut self) -> &mut u8 {
        &mut self.threshold
    }
    fn members(&mut self) -> &mut Vec<Member> {
        &mut self.members
    }
}

impl CompressedSettings {
    pub fn invariant(&mut self) -> Result<()> {
        MultisigSettings::invariant(self)
    }
    pub fn edit_permissions(&mut self, members: Vec<MemberKeyWithPermissionsArgs>) {
        MultisigSettings::edit_permissions(self, members)
    }
    pub fn add_members<'a>(
        &mut self,
        settings: &Pubkey,
        new_members: Vec<MemberWithCreationArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: &Option<UncheckedAccount<'a>>,
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
    pub fn set_threshold(&mut self, new_threshold: u8) {
        MultisigSettings::set_threshold(self, new_threshold)
    }
    pub fn create_settings_account<'info>(
        settings_creation_args: SettingsCreationArgs,
        settings: Settings,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<(CompressedAccountInfo, NewAddressParamsPacked)> {
        let (address, address_seed) = derive_address(
            &[SEED_MULTISIG, settings.index.to_le_bytes().as_ref()],
            &settings_creation_args
                .address_tree_info
                .get_tree_pubkey(light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
            &crate::ID,
        );

        let new_address_params = settings_creation_args
            .address_tree_info
            .into_new_address_params_packed(address_seed);

        let mut settings_account = LightAccount::<'_, CompressedSettings>::new_init(
            &crate::ID,
            Some(address),
            settings_creation_args.output_state_tree_index,
        );

        settings_account.index = settings.index;
        settings_account.members = settings.members;
        settings_account.multi_wallet_bump = settings.multi_wallet_bump;
        settings_account.bump = settings.bump;
        settings_account.threshold = settings.threshold;

        Ok((
            settings_account
                .to_account_info()
                .map_err(ProgramError::from)?,
            new_address_params,
        ))
    }

    pub fn close_settings_account<'info>(
        settings_close_args: SettingsCloseArgs,
    ) -> Result<CompressedAccountInfo> {
        let settings_account = LightAccount::<'_, CompressedSettings>::new_close(
            &crate::ID,
            &settings_close_args.account_meta,
            settings_close_args.data,
        )
        .map_err(ProgramError::from)?;

        Ok(settings_account
            .to_account_info()
            .map_err(ProgramError::from)?)
    }
}

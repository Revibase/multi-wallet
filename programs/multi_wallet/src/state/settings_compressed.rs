use crate::{
    AddMemberArgs, EditMemberArgs, KeyType, Member, MemberKey, MultisigError, MultisigSettings,
    Permission, Permissions, RemoveMemberArgs, Settings, UserRole, LIGHT_CPI_SIGNER, SEED_MULTISIG,
};
use anchor_lang::prelude::*;
use light_sdk::address::NewAddressParamsAssignedPacked;
use light_sdk::cpi::{v2::LightSystemProgramCpi, InvokeLightSystemProgram, LightCpiInstruction};
use light_sdk::instruction::account_meta::CompressedAccountMeta;
use light_sdk::instruction::CompressedProof;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::v2::CpiAccounts,
    instruction::{
        account_meta::CompressedAccountMetaReadOnly, PackedAddressTreeInfo, ValidityProof,
    },
    LightDiscriminator,
};
use std::collections::HashSet;

#[derive(
    AnchorDeserialize, AnchorSerialize, LightDiscriminator, PartialEq, Default, Debug, Clone,
)]
pub struct CompressedSettings {
    pub data: Option<CompressedSettingsData>,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug, Clone)]
pub struct CompressedSettingsData {
    pub index: u128,
    pub members: Vec<Member>,
    pub threshold: u8,
    pub multi_wallet_bump: u8,
    pub bump: u8,
    pub settings_address_tree_index: u8,
    pub latest_slot_number: u64,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug, Clone)]
pub struct SettingsIndexWithAddress {
    pub index: u128,
    pub settings_address_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SettingsCreationArgs {
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, Debug)]
pub struct SettingsMutArgs {
    pub account_meta: CompressedAccountMeta,
    pub data: CompressedSettings,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SettingsReadonlyArgs {
    pub account_meta: CompressedAccountMetaReadOnly,
    pub data: CompressedSettings,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct ProofArgs {
    pub proof: Option<CompressedProof>,
    pub light_cpi_accounts_start_index: u8,
}

impl CompressedSettings {
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

    pub fn create_compressed_settings_account(
        settings_creation: SettingsCreationArgs,
        address_tree: &Pubkey,
        data: CompressedSettingsData,
        index: Option<u8>,
    ) -> Result<(
        LightAccount<CompressedSettings>,
        NewAddressParamsAssignedPacked,
    )> {
        let settings_key = Settings::get_settings_key_from_index(data.index)?;
        let (address, address_seed) = derive_address(
            &[SEED_MULTISIG, settings_key.as_ref()],
            address_tree,
            &crate::ID,
        );

        let new_address_params = settings_creation
            .address_tree_info
            .into_new_address_params_assigned_packed(address_seed, index);

        let mut settings_account = LightAccount::<CompressedSettings>::new_init(
            &crate::ID,
            Some(address),
            settings_creation.output_state_tree_index,
        );

        settings_account.data = Some(data);

        Ok((settings_account, new_address_params))
    }

    pub fn verify_readonly_compressed_settings_account<'a, 'info>(
        payer: &AccountInfo<'info>,
        settings_readonly_args: &'a SettingsReadonlyArgs,
        remaining_accounts: &[AccountInfo<'info>],
        compressed_proof_args: &ProofArgs,
    ) -> Result<(&'a CompressedSettingsData, Pubkey)> {
        let settings_data = settings_readonly_args
            .data
            .data
            .as_ref()
            .ok_or(MultisigError::MissingSettingsData)?;

        let settings_key = Settings::get_settings_key_from_index_with_bump(
            settings_data.index,
            settings_data.bump,
        )?;

        let light_cpi_accounts = CpiAccounts::new(
            payer,
            &remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let read_only_account = LightAccount::<CompressedSettings>::new_read_only(
            &crate::ID,
            &settings_readonly_args.account_meta,
            settings_readonly_args.data.clone(),
            light_cpi_accounts
                .tree_pubkeys()
                .map_err(|_| MultisigError::MissingLightCpiAccounts)?
                .as_slice(),
        )?;

        LightSystemProgramCpi::new_cpi(
            crate::LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(read_only_account)?
        .invoke(light_cpi_accounts)?;

        Ok((settings_data, settings_key))
    }
}

impl MultisigSettings for CompressedSettings {
    fn is_compressed(&self) -> Result<bool> {
        Ok(true)
    }

    fn set_threshold(&mut self, value: u8) -> Result<()> {
        if let Some(data) = &mut self.data {
            data.threshold = value;
        }
        Ok(())
    }

    fn set_latest_slot_number(&mut self, value: u64) -> Result<()> {
        if let Some(data) = &mut self.data {
            data.latest_slot_number = value;
        }
        Ok(())
    }

    fn get_latest_slot_number(&self) -> Result<u64> {
        if let Some(data) = &self.data {
            Ok(data.latest_slot_number)
        } else {
            err!(MultisigError::MissingSettingsData)
        }
    }

    fn get_threshold(&self) -> Result<u8> {
        if let Some(data) = &self.data {
            Ok(data.threshold)
        } else {
            err!(MultisigError::MissingSettingsData)
        }
    }

    fn get_members_mut(&mut self) -> Result<&mut [Member]> {
        if let Some(data) = &mut self.data {
            Ok(data.members.as_mut_slice())
        } else {
            err!(MultisigError::MissingSettingsData)
        }
    }

    fn get_members(&self) -> Result<&[Member]> {
        if let Some(data) = &self.data {
            Ok(data.members.as_slice())
        } else {
            err!(MultisigError::MissingSettingsData)
        }
    }

    fn extend_members(&mut self, members: Vec<Member>) -> Result<()> {
        if let Some(data) = &mut self.data {
            data.members.extend(members);
        }
        Ok(())
    }

    fn delete_members(&mut self, members: Vec<MemberKey>) -> Result<()> {
        if let Some(data) = &mut self.data {
            let existing: HashSet<_> = data.members.iter().map(|m| m.pubkey).collect();
            if members.iter().any(|m| !existing.contains(&m)) {
                return err!(MultisigError::MemberNotFound);
            }
            let to_delete: HashSet<_> = HashSet::from_iter(members);
            data.members.retain(|m| !to_delete.contains(&m.pubkey));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::settings::MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS;

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

    fn mk_compressed_settings(members: Vec<Member>, threshold: u8) -> CompressedSettings {
        CompressedSettings {
            data: Some(CompressedSettingsData {
                index: 0,
                members,
                threshold,
                multi_wallet_bump: 0,
                bump: 0,
                settings_address_tree_index: 0,
                latest_slot_number: 0,
            }),
        }
    }

    #[test]
    fn test_invariant_valid_minimal() {
        let settings = mk_compressed_settings(
            vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::Member,
                false,
            )],
            1,
        );
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_at_max_members() {
        let members: Vec<Member> = (0..MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS)
            .map(|i| {
                mk_ed25519_member(
                    i as u8,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                )
            })
            .collect();
        let settings = mk_compressed_settings(members, 1);
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_too_many_members() {
        let members: Vec<Member> = (0..=MAXIMUM_AMOUNT_OF_MEMBERS_FOR_COMPRESSED_SETTINGS)
            .map(|i| {
                mk_ed25519_member(
                    i as u8,
                    vec![
                        Permission::InitiateTransaction,
                        Permission::VoteTransaction,
                        Permission::ExecuteTransaction,
                    ],
                    UserRole::Member,
                    false,
                )
            })
            .collect();
        let settings = mk_compressed_settings(members, 1);
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_empty_members() {
        let settings = mk_compressed_settings(vec![], 1);
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_zero_threshold() {
        let settings = mk_compressed_settings(
            vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::Member,
                false,
            )],
            0,
        );
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
        let settings = mk_compressed_settings(vec![member, member], 1);
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_permanent_member_valid() {
        let settings = mk_compressed_settings(
            vec![mk_ed25519_member(
                1,
                vec![
                    Permission::InitiateTransaction,
                    Permission::VoteTransaction,
                    Permission::ExecuteTransaction,
                ],
                UserRole::PermanentMember,
                true,
            )],
            1,
        );
        assert!(settings.invariant().is_ok());
    }

    #[test]
    fn test_invariant_two_permanent_members_fails() {
        let settings = mk_compressed_settings(
            vec![
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
            1,
        );
        assert!(settings.invariant().is_err());
    }

    #[test]
    fn test_invariant_missing_data() {
        let settings = CompressedSettings { data: None };
        assert!(settings.invariant().is_err());
    }
}

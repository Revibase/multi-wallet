use crate::{
    AddMemberArgs, EditMemberArgs, Member, MemberKey, MultisigError, MultisigSettings,
    RemoveMemberArgs, Settings, LIGHT_CPI_SIGNER, SEED_MULTISIG,
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
    pub threshold: u8,
    pub bump: u8,
    pub index: u128,
    pub multi_wallet_bump: u8,
    pub members: Vec<Member>,
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
        let (address, address_seed) = derive_address(
            &[SEED_MULTISIG, data.index.to_le_bytes().as_ref()],
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

    pub fn verify_readonly_compressed_settings_account<'info>(
        payer: &AccountInfo<'info>,
        settings_readonly_args: &SettingsReadonlyArgs,
        remaining_accounts: &[AccountInfo<'info>],
        compressed_proof_args: &ProofArgs,
    ) -> Result<(CompressedSettingsData, Pubkey)> {
        let settings_data = settings_readonly_args
            .data
            .data
            .as_ref()
            .ok_or(MultisigError::MissingSettingsData)?;

        let settings_key =
            Settings::get_settings_key_from_index(settings_data.index, settings_data.bump)?;

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

        Ok((settings_data.clone(), settings_key))
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

    fn get_members(&self) -> Result<Vec<Member>> {
        if let Some(data) = &self.data {
            Ok(data.members.clone())
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

    fn set_members(&mut self, members: Vec<Member>) -> Result<()> {
        if let Some(data) = &mut self.data {
            data.members = members;
        }
        Ok(())
    }
}

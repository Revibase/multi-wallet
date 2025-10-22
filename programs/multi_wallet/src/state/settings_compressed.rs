use crate::{
    Member, MemberKey, MemberKeyWithEditPermissionsArgs, MemberKeyWithRemovePermissionsArgs,
    MemberWithAddPermissionsArgs, MultisigError, MultisigSettings, Settings, LIGHT_CPI_SIGNER,
    SEED_MULTISIG, SEED_VERSION,
};
use anchor_lang::prelude::*;
use light_compressed_account::compressed_account::{CompressedAccount, CompressedAccountData};
use light_compressed_account::instruction_data::data::NewAddressParamsPacked;
use light_compressed_account::{
    compressed_account::PackedReadOnlyCompressedAccount,
    instruction_data::with_readonly::InstructionDataInvokeCpiWithReadOnly,
};
use light_hasher::{Hasher, Sha256};
use light_sdk::cpi::{invoke::invoke_light_system_program, v1::CpiAccounts};
use light_sdk::error::LightSdkError;
use light_sdk::instruction::PackedMerkleContext;
use light_sdk::{
    account::LightAccount,
    cpi::CpiAccountsTrait,
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof},
    LightDiscriminator,
};
use light_sdk_types::{address::v1::derive_address, LIGHT_SYSTEM_PROGRAM_ID};

#[derive(AnchorDeserialize, AnchorSerialize, LightDiscriminator, PartialEq, Default, Debug)]
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
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SettingsCreationArgs {
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SettingsMutArgs {
    pub account_meta: CompressedAccountMeta,
    pub data: CompressedSettings,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum SettingsCreateOrMutateArgs {
    Create(SettingsCreationArgs),
    Mutate(SettingsMutArgs),
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct ProofArgs {
    pub proof: ValidityProof,
    pub light_cpi_accounts_start_index: u8,
}

impl CompressedSettings {
    pub fn edit_permissions(
        &mut self,
        members: Vec<MemberKeyWithEditPermissionsArgs>,
    ) -> Result<(
        Vec<MemberWithAddPermissionsArgs>,
        Vec<MemberKeyWithRemovePermissionsArgs>,
    )> {
        MultisigSettings::edit_permissions(self, members)
    }
    pub fn add_members<'a>(
        &mut self,
        settings: &Pubkey,
        new_members: Vec<MemberWithAddPermissionsArgs>,
        remaining_accounts: &'a [AccountInfo<'a>],
        sysvar_slot_history: &Option<UncheckedAccount<'a>>,
        instructions_sysvar: Option<&UncheckedAccount<'a>>,
    ) -> Result<Vec<MemberWithAddPermissionsArgs>> {
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
        member_pubkeys: Vec<MemberKeyWithRemovePermissionsArgs>,
    ) -> Result<Vec<MemberKeyWithRemovePermissionsArgs>> {
        MultisigSettings::remove_members(self, member_pubkeys)
    }

    pub fn set_threshold(&mut self, value: u8) -> Result<()> {
        MultisigSettings::set_threshold(self, value)
    }

    pub fn invariant(&self) -> Result<()> {
        MultisigSettings::invariant(self)
    }

    pub fn create_compressed_settings_account<'info>(
        settings_creation: SettingsCreationArgs,
        data: CompressedSettingsData,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<(
        LightAccount<'info, CompressedSettings>,
        NewAddressParamsPacked,
    )> {
        let (address, address_seed) = derive_address(
            &[
                SEED_MULTISIG,
                data.index.to_le_bytes().as_ref(),
                SEED_VERSION,
            ],
            &settings_creation
                .address_tree_info
                .get_tree_pubkey(light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?
                .to_bytes(),
            &crate::ID.to_bytes(),
        );

        let new_address_params = settings_creation
            .address_tree_info
            .into_new_address_params_packed(address_seed);

        let mut settings_account = LightAccount::<'_, CompressedSettings>::new_init(
            &crate::ID,
            Some(address),
            settings_creation.output_state_tree_index,
        );

        settings_account.data = Some(data);

        Ok((settings_account, new_address_params))
    }

    pub fn verify_compressed_settings_account<'info>(
        payer: &AccountInfo<'info>,
        settings_readonly_args: &SettingsMutArgs,
        remaining_accounts: &[AccountInfo<'info>],
        compressed_proof_args: &ProofArgs,
    ) -> Result<(CompressedSettingsData, Pubkey)> {
        let settings_data = settings_readonly_args
            .data
            .data
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;

        let settings_key =
            Settings::get_settings_key_from_index(settings_data.index, settings_data.bump)?;

        let light_cpi_accounts = CpiAccounts::new(
            payer,
            &remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );

        let data = settings_readonly_args
            .data
            .try_to_vec()
            .map_err(|_| LightSdkError::Borsh)
            .map_err(ProgramError::from)?;

        let mut input_data_hash = Sha256::hash(data.as_slice())
            .map_err(LightSdkError::from)
            .map_err(ProgramError::from)?;
        input_data_hash[0] = 0;

        let compressed_account = CompressedAccount {
            address: Some(settings_readonly_args.account_meta.address),
            owner: crate::ID.to_bytes().into(),
            data: Some(CompressedAccountData {
                data: vec![],
                data_hash: input_data_hash,
                discriminator: CompressedSettings::discriminator(),
            }),
            lamports: 0,
        };
        let merkle_tree_pubkey = light_cpi_accounts
            .get_tree_account_info(
                settings_readonly_args
                    .account_meta
                    .tree_info
                    .merkle_tree_pubkey_index as usize,
            )
            .unwrap()
            .key
            .to_bytes()
            .into();
        let account_hash = compressed_account
            .hash(
                &merkle_tree_pubkey,
                &settings_readonly_args.account_meta.tree_info.leaf_index,
                true,
            )
            .unwrap();

        let instruction_data = InstructionDataInvokeCpiWithReadOnly {
            read_only_accounts: vec![PackedReadOnlyCompressedAccount {
                root_index: settings_readonly_args.account_meta.tree_info.root_index,
                merkle_context: PackedMerkleContext {
                    merkle_tree_pubkey_index: settings_readonly_args
                        .account_meta
                        .tree_info
                        .merkle_tree_pubkey_index,
                    queue_pubkey_index: settings_readonly_args
                        .account_meta
                        .tree_info
                        .queue_pubkey_index,
                    leaf_index: settings_readonly_args.account_meta.tree_info.leaf_index,
                    prove_by_index: settings_readonly_args.account_meta.tree_info.prove_by_index,
                },
                account_hash,
            }],
            proof: compressed_proof_args.proof.into(),
            bump: LIGHT_CPI_SIGNER.bump,
            invoking_program_id: LIGHT_CPI_SIGNER.program_id.into(),
            mode: 0,
            ..Default::default()
        };

        let inputs = instruction_data.try_to_vec().unwrap();

        let mut data = Vec::with_capacity(8 + inputs.len());
        data.extend_from_slice(
            &light_compressed_account::discriminators::DISCRIMINATOR_INVOKE_CPI_WITH_READ_ONLY,
        );
        data.extend(inputs);

        let account_infos = light_cpi_accounts
            .to_account_infos()
            .iter()
            .map(|e| e.to_account_info())
            .collect::<Vec<_>>();

        let account_metas: Vec<AccountMeta> = light_cpi_accounts.to_account_metas()?;

        let instruction = anchor_lang::solana_program::instruction::Instruction {
            accounts: account_metas,
            data,
            program_id: LIGHT_SYSTEM_PROGRAM_ID.into(),
        };

        invoke_light_system_program(account_infos.as_slice(), instruction, LIGHT_CPI_SIGNER.bump)
            .map_err(ProgramError::from)?;

        Ok((settings_data.clone(), settings_key))
    }
}

impl MultisigSettings for CompressedSettings {
    fn set_threshold(&mut self, value: u8) -> Result<()> {
        if let Some(data) = &mut self.data {
            data.threshold = value;
        }
        Ok(())
    }

    fn get_threshold(&self) -> Result<u8> {
        if let Some(data) = &self.data {
            Ok(data.threshold)
        } else {
            err!(MultisigError::InvalidArguments)
        }
    }

    fn get_members(&self) -> Result<Vec<Member>> {
        if let Some(data) = &self.data {
            Ok(data.members.clone())
        } else {
            err!(MultisigError::InvalidArguments)
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
            data.members.retain(|m| !members.contains(&m.pubkey));
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

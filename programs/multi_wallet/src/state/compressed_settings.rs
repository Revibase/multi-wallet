use crate::{
    error::MultisigError,
    state::{
        Member, MemberKey, MemberKeyWithEditPermissionsArgs, MemberKeyWithRemovePermissionsArgs,
        MemberWithAddPermissionsArgs, MultisigSettings, Settings, SEED_MULTISIG,
    },
    LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::instruction::Instruction};
use light_compressed_account::compressed_account::{CompressedAccount, CompressedAccountData};
use light_compressed_account::{
    compressed_account::PackedReadOnlyCompressedAccount,
    instruction_data::{
        compressed_proof::CompressedProof, cpi_context::CompressedCpiContext,
        data::NewAddressParamsPacked, with_readonly::InstructionDataInvokeCpiWithReadOnly,
    },
};
use light_hasher::{DataHasher, Poseidon};
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{to_account_metas, CpiAccounts},
    error::LightSdkError,
    instruction::{
        account_meta::CompressedAccountMeta, PackedAddressTreeInfo, PackedMerkleContext,
        ValidityProof,
    },
    LightDiscriminator, LightHasher,
};
use light_sdk_types::{CPI_AUTHORITY_PDA_SEED, LIGHT_SYSTEM_PROGRAM_ID};

#[derive(
    AnchorDeserialize, AnchorSerialize, LightDiscriminator, LightHasher, PartialEq, Default, Debug,
)]
pub struct CompressedSettings {
    pub data: Option<CompressedSettingsData>,
}

#[derive(AnchorDeserialize, AnchorSerialize, LightHasher, PartialEq, Debug, Clone)]
pub struct CompressedSettingsData {
    pub threshold: u8,
    pub bump: u8,
    pub index: u128,
    pub multi_wallet_bump: u8,
    #[hash]
    pub members: Vec<Member>,
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

    pub fn create_settings_account<'info>(
        settings_creation: SettingsCreationArgs,
        data: CompressedSettingsData,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<(
        LightAccount<'info, CompressedSettings>,
        NewAddressParamsPacked,
    )> {
        let (address, address_seed) = derive_address(
            &[SEED_MULTISIG, data.index.to_le_bytes().as_ref()],
            &settings_creation
                .address_tree_info
                .get_tree_pubkey(light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
            &crate::ID,
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

    pub fn set_threshold(&mut self, value: u8) -> Result<()> {
        MultisigSettings::set_threshold(self, value)
    }

    pub fn invariant(&mut self) -> Result<()> {
        MultisigSettings::invariant(self)
    }

    pub fn verify_compressed_settings<'info>(
        payer: &AccountInfo<'info>,
        settings_readonly: &SettingsReadonlyArgs,
        remaining_accounts: &[AccountInfo<'info>],
        compressed_proof_args: &ProofArgs,
    ) -> Result<(CompressedSettingsData, Pubkey)> {
        let light_cpi_accounts = CpiAccounts::new(
            payer,
            &remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );
        let merkle_context = settings_readonly.merkle_context;
        let settings = &settings_readonly.data;
        let data_hash = settings
            .hash::<Poseidon>()
            .map_err(|_| MultisigError::InvalidArguments)?;
        let settings_data = settings
            .data
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;
        let settings_key =
            Settings::get_settings_key_from_index(settings_data.index, settings_data.bump)?;
        let merkle_tree_pubkey = light_cpi_accounts
            .get_tree_account_info(merkle_context.merkle_tree_pubkey_index.into())
            .map_err(|_| MultisigError::InvalidAccount)?
            .key;
        let (address, _) = derive_address(
            &[SEED_MULTISIG, settings_data.index.to_le_bytes().as_ref()],
            &settings_readonly
                .address_tree_info
                .get_tree_pubkey(&light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
            &crate::ID,
        );

        let account_hash = CompressedAccount {
            owner: light_cpi_accounts.invoking_program().unwrap().key().into(),
            lamports: settings_readonly.lamports,
            address: Some(address),
            data: Some(CompressedAccountData {
                discriminator: CompressedSettings::discriminator(),
                data: settings.try_to_vec()?,
                data_hash,
            }),
        }
        .hash(
            &light_compressed_account::Pubkey::from(merkle_tree_pubkey),
            &merkle_context.leaf_index,
            false,
        )
        .unwrap();

        let _account_infos: Vec<AccountInfo> = light_cpi_accounts
            .to_account_infos()
            .into_iter()
            .cloned()
            .collect();

        let _cpi_authority_seeds = [CPI_AUTHORITY_PDA_SEED, &[light_cpi_accounts.bump()]];

        let _instruction = CompressedSettings::compressed_settings_invoke_cpi_with_read_only(
            vec![PackedReadOnlyCompressedAccount {
                account_hash,
                merkle_context,
                root_index: settings_readonly.address_tree_info.root_index,
            }],
            light_cpi_accounts,
            compressed_proof_args.proof.0,
        )?;

        // invoke_signed(
        //     &instruction,
        //     &account_infos,
        //     &[cpi_authority_seeds.as_slice()],
        // )?;

        Ok((settings_data.clone(), settings_key))
    }

    fn compressed_settings_invoke_cpi_with_read_only(
        read_only_accounts: Vec<PackedReadOnlyCompressedAccount>,
        cpi_accounts: CpiAccounts,
        proof: Option<CompressedProof>,
    ) -> Result<Instruction> {
        let inputs = InstructionDataInvokeCpiWithReadOnly {
            mode: 0,
            bump: cpi_accounts.bump(),
            invoking_program_id: cpi_accounts.self_program_id().into(),
            compress_or_decompress_lamports: 0,
            is_compress: false,
            with_cpi_context: false,
            with_transaction_hash: true,
            cpi_context: CompressedCpiContext::default(),
            proof,
            new_address_params: vec![],
            input_compressed_accounts: vec![],
            output_compressed_accounts: vec![],
            read_only_addresses: vec![],
            read_only_accounts,
        };

        let inputs = inputs
            .try_to_vec()
            .map_err(|_| LightSdkError::Borsh)
            .unwrap();

        let mut data = Vec::with_capacity(8 + inputs.len());
        data.extend_from_slice(
            &light_compressed_account::discriminators::DISCRIMINATOR_INVOKE_CPI_WITH_READ_ONLY,
        );
        data.extend(inputs);

        let account_metas = to_account_metas(cpi_accounts).unwrap();

        Ok(Instruction {
            program_id: LIGHT_SYSTEM_PROGRAM_ID.into(),
            accounts: account_metas,
            data,
        })
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

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SettingsReadonlyArgs {
    pub merkle_context: PackedMerkleContext,
    pub address_tree_info: PackedAddressTreeInfo,
    pub data: CompressedSettings,
    pub lamports: u64,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct ProofArgs {
    pub proof: ValidityProof,
    pub light_cpi_accounts_start_index: u8,
}

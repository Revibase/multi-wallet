use crate::{
    error::MultisigError,
    state::{CompressedSettings, Settings, SettingsProofArgs},
    LIGHT_CPI_SIGNER,
};
use anchor_lang::{prelude::*, solana_program::program::invoke_signed};
use light_hasher::{DataHasher, Poseidon};
use light_sdk::{
    cpi::{create_light_system_progam_instruction_invoke_cpi, CpiAccounts, CpiInputs},
    instruction::ValidityProof,
};
use light_sdk_types::CPI_AUTHORITY_PDA_SEED;

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Copy)]
pub struct ProofArgs {
    pub proof: ValidityProof,
    pub light_cpi_accounts_start_index: u8,
}

pub fn invoke_light_system_program_with_payer_seeds(
    cpi_inputs: CpiInputs,
    cpi_accounts: CpiAccounts,
    payer_seeds: &[&[u8]],
) -> Result<()> {
    let bump = cpi_accounts.bump();
    let account_info_refs = cpi_accounts.to_account_infos();
    let instruction =
        create_light_system_progam_instruction_invoke_cpi(cpi_inputs, cpi_accounts).unwrap();
    let account_infos: Vec<AccountInfo> = account_info_refs.into_iter().cloned().collect();
    let cpi_authority_seeds = [CPI_AUTHORITY_PDA_SEED, &[bump]];

    invoke_signed(
        &instruction,
        &account_infos,
        &[payer_seeds, cpi_authority_seeds.as_slice()],
    )?;

    Ok(())
}

pub fn verify_compressed_settings<'info>(
    payer: &AccountInfo<'info>,
    _payer_seeds: Option<&[&[u8]]>,
    settings_args: &SettingsProofArgs,
    remaining_accounts: &[AccountInfo<'info>],
    compressed_proof_args: ProofArgs,
) -> Result<(CompressedSettings, Pubkey)> {
    let _light_cpi_accounts = CpiAccounts::new(
        &payer,
        &remaining_accounts[compressed_proof_args.light_cpi_accounts_start_index as usize..],
        LIGHT_CPI_SIGNER,
    );

    let _merkle_context = &settings_args.merkle_context;
    let account_data = settings_args
        .account
        .data
        .as_ref()
        .ok_or(MultisigError::InvalidAccount)?;
    let mut data_slice = account_data.data.as_slice();

    let settings = CompressedSettings::deserialize(&mut data_slice)?;

    let expected_data_hash = settings.hash::<Poseidon>().unwrap();
    let mut actual_data_hash = account_data.data_hash;
    actual_data_hash.reverse();

    require!(
        expected_data_hash.eq(&actual_data_hash),
        MultisigError::InvalidAccount
    );

    // let merkle_tree_pubkey = light_cpi_accounts
    //     .get_tree_account_info(merkle_context.merkle_tree_pubkey_index.into())
    //     .unwrap()
    //     .key;

    // let account_hash = CompressedAccount {
    //     owner: settings_args.account.owner,
    //     lamports: settings_args.account.lamports,
    //     address: settings_args.account.address,
    //     data: Some(CompressedAccountData {
    //         discriminator: account_data.discriminator,
    //         data: account_data.data.clone(),
    //         data_hash: actual_data_hash,
    //     }),
    // }
    // .hash(
    //     &light_compressed_account::Pubkey::from(merkle_tree_pubkey),
    //     &settings_args.merkle_context.leaf_index,
    //     false,
    // )
    // .unwrap();

    // let account_info_refs = light_cpi_accounts.to_account_infos();
    // let account_infos: Vec<AccountInfo> = account_info_refs.into_iter().cloned().collect();

    // let cpi_authority_seeds = [CPI_AUTHORITY_PDA_SEED, &[light_cpi_accounts.bump()]];
    // let instruction = compressed_settings_invoke_cpi_with_read_only(
    //     vec![PackedReadOnlyCompressedAccount {
    //         account_hash,
    //         merkle_context: settings_args.merkle_context,
    //         root_index: settings_args.root_index,
    //     }],
    //     light_cpi_accounts,
    //     compressed_proof_args.proof.into(),
    // )
    // .unwrap();

    // match payer_seeds {
    //     Some(payer_seed) => invoke_signed(
    //         &instruction,
    //         &account_infos,
    //         &[payer_seed, cpi_authority_seeds.as_slice()],
    //     )?,
    //     None => invoke_signed(
    //         &instruction,
    //         &account_infos,
    //         &[cpi_authority_seeds.as_slice()],
    //     )?,
    // }

    let settings_key = Settings::get_settings_key_from_index(settings.index, settings.bump)?;

    Ok((settings, settings_key))
}

// fn compressed_settings_invoke_cpi_with_read_only(
//     read_only_accounts: Vec<PackedReadOnlyCompressedAccount>,
//     cpi_accounts: CpiAccounts,
//     proof: Option<CompressedProof>,
// ) -> Result<Instruction> {
//     let inputs = InstructionDataInvokeCpiWithReadOnly {
//         mode: 0,
//         bump: cpi_accounts.bump(),
//         invoking_program_id: cpi_accounts.self_program_id().into(),
//         compress_or_decompress_lamports: 0,
//         is_compress: false,
//         with_cpi_context: false,
//         with_transaction_hash: true,
//         cpi_context: CompressedCpiContext::default(),
//         proof,
//         new_address_params: vec![],
//         input_compressed_accounts: vec![],
//         output_compressed_accounts: vec![],
//         read_only_addresses: vec![],
//         read_only_accounts,
//     };

//     let inputs = inputs
//         .try_to_vec()
//         .map_err(|_| LightSdkError::Borsh)
//         .unwrap();

//     let mut data = Vec::with_capacity(8 + inputs.len());
//     data.extend_from_slice(
//         &light_compressed_account::discriminators::DISCRIMINATOR_INVOKE_CPI_WITH_READ_ONLY,
//     );
//     for input in inputs.iter() {
//         input
//             .serialize(&mut data)
//             .map_err(|_| LightSdkError::Borsh)
//             .unwrap();
//     }

//     let account_metas: Vec<AccountMeta> = to_account_metas(cpi_accounts).unwrap();
//     Ok(Instruction {
//         program_id: LIGHT_SYSTEM_PROGRAM_ID.into(),
//         accounts: account_metas,
//         data,
//     })
// }

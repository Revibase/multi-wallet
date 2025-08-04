use crate::{
    error::MultisigError,
    state::{MemberKey, MemberKeyWithCloseArgs, MemberWithCreationArgs, SEED_DELEGATE},
};
use anchor_lang::prelude::*;
use light_compressed_account::instruction_data::{
    data::NewAddressParamsPacked, with_account_info::CompressedAccountInfo,
};
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::CpiAccounts,
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo},
    LightDiscriminator, LightHasher,
};
use std::collections::HashMap;

#[derive(
    Default, AnchorDeserialize, AnchorSerialize, LightDiscriminator, LightHasher, PartialEq,
)]
pub struct Delegate {
    pub index: Option<u128>,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub enum DelegateCreateOrMutateArgs {
    Create(DelegateCreationArgs),
    Mutate(DelegateMutArgs),
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct DelegateCreationArgs {
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct DelegateMutArgs {
    pub account_meta: CompressedAccountMeta,
    pub data: Delegate,
}

#[derive(PartialEq)]
pub enum DelegateOp {
    Create(MemberWithCreationArgs),
    Close(MemberKeyWithCloseArgs),
}

impl Delegate {
    pub fn create_delegate_account<'info>(
        delegate_creation_args: DelegateCreationArgs,
        member: &MemberKey,
        settings_index: u128,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<(CompressedAccountInfo, NewAddressParamsPacked)> {
        let (address, address_seed) = derive_address(
            &[SEED_DELEGATE, member.get_seed().as_ref()],
            &delegate_creation_args
                .address_tree_info
                .get_tree_pubkey(light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
            &crate::ID,
        );

        let new_address_params = delegate_creation_args
            .address_tree_info
            .into_new_address_params_packed(address_seed);

        let mut delegate_account = LightAccount::<'_, Delegate>::new_init(
            &crate::ID,
            Some(address),
            delegate_creation_args.output_state_tree_index,
        );

        delegate_account.index = Some(settings_index);

        Ok((
            delegate_account
                .to_account_info()
                .map_err(ProgramError::from)?,
            new_address_params,
        ))
    }

    pub fn recreate_delegate_account<'info>(
        delegate_mut_args: DelegateMutArgs,
        settings_index: u128,
    ) -> Result<CompressedAccountInfo> {
        let mut delegate_account = LightAccount::<'_, Delegate>::new_mut(
            &crate::ID,
            &delegate_mut_args.account_meta,
            delegate_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        delegate_account.index = Some(settings_index);

        Ok(delegate_account
            .to_account_info()
            .map_err(ProgramError::from)?)
    }

    fn close_delegate_account<'info>(
        delegate_mut_args: Option<DelegateMutArgs>,
    ) -> Result<CompressedAccountInfo> {
        let delegate_args = delegate_mut_args.ok_or(MultisigError::MissingDelegateArgs)?;
        let mut delegate_account = LightAccount::<'_, Delegate>::new_mut(
            &crate::ID,
            &delegate_args.account_meta,
            delegate_args.data,
        )
        .map_err(ProgramError::from)?;

        delegate_account.index = None;

        Ok(delegate_account
            .to_account_info()
            .map_err(ProgramError::from)?)
    }

    pub fn handle_delegate_accounts<'info>(
        delegate_ops: Vec<DelegateOp>,
        settings_index: u128,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<(Vec<CompressedAccountInfo>, Vec<NewAddressParamsPacked>)> {
        let mut net_ops: HashMap<MemberKey, Option<DelegateOp>> = HashMap::new();

        for op in delegate_ops {
            let key = match &op {
                DelegateOp::Create(pk) => &pk.data.pubkey,
                DelegateOp::Close(pk) => &pk.data,
            };
            match net_ops.get(&key) {
                Some(Some(prev)) if prev != &op => {
                    net_ops.insert(*key, None); // cancel out
                }
                _ => {
                    net_ops.insert(*key, Some(op));
                }
            }
        }

        let mut final_account_infos: Vec<CompressedAccountInfo> = vec![];
        let mut final_new_addresses: Vec<NewAddressParamsPacked> = vec![];

        let mut actions: Vec<_> = net_ops.into_values().flatten().collect();

        actions.sort_by_key(|op| match op {
            DelegateOp::Close(_) => 0,
            DelegateOp::Create(pk) => match pk.delegate_args {
                Some(DelegateCreateOrMutateArgs::Mutate(_)) => 1,
                Some(DelegateCreateOrMutateArgs::Create(_)) => 2,
                None => 3,
            },
        });

        for action in actions {
            match action {
                DelegateOp::Close(pk) => {
                    final_account_infos.push(Delegate::close_delegate_account(pk.delegate_args)?);
                }
                DelegateOp::Create(pk) => {
                    let (account_infos, new_addresses) =
                        Delegate::handle_create_or_recreate_delegate(
                            pk.delegate_args,
                            settings_index,
                            pk.data.pubkey,
                            light_cpi_accounts,
                        )?;
                    final_account_infos.extend(account_infos);
                    final_new_addresses.extend(new_addresses);
                }
            }
        }

        Ok((final_account_infos, final_new_addresses))
    }

    pub fn handle_create_or_recreate_delegate(
        delegate_args: Option<DelegateCreateOrMutateArgs>,
        settings_index: u128,
        signer: MemberKey,
        light_cpi_accounts: &light_sdk_types::CpiAccounts<'_, AccountInfo<'_>>,
    ) -> Result<(Vec<CompressedAccountInfo>, Vec<NewAddressParamsPacked>)> {
        let mut account_infos = vec![];
        let mut new_addresses = vec![];
        if let Some(delegate_args) = delegate_args {
            match delegate_args {
                DelegateCreateOrMutateArgs::Mutate(delegate_mut_args) => {
                    let account_info =
                        Delegate::recreate_delegate_account(delegate_mut_args, settings_index)?;
                    account_infos.push(account_info);
                }
                DelegateCreateOrMutateArgs::Create(delegate_create_args) => {
                    let (account_info, new_address_params) = Delegate::create_delegate_account(
                        delegate_create_args,
                        &signer,
                        settings_index,
                        light_cpi_accounts,
                    )?;
                    account_infos.push(account_info);
                    new_addresses.push(new_address_params);
                }
            }
        } else {
            return err!(MultisigError::MissingDelegateArgs);
        }

        Ok((account_infos, new_addresses))
    }
}

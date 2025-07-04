use std::collections::HashMap;

use anchor_lang::prelude::*;
use light_compressed_account::instruction_data::{
    data::NewAddressParamsPacked, with_account_info::CompressedAccountInfo,
};
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::CpiAccounts,
    instruction::{account_meta::CompressedAccountMetaClose, PackedAddressTreeInfo},
    LightDiscriminator, LightHasher,
};

use crate::{
    error::MultisigError,
    state::{MemberKey, MemberKeyWithCloseArgs, MemberWithCreationArgs, SEED_DELEGATE},
};

#[derive(
    Clone,
    Debug,
    Default,
    AnchorDeserialize,
    AnchorSerialize,
    LightDiscriminator,
    LightHasher,
    Copy,
    PartialEq,
)]
pub struct Delegate {
    pub index: u128,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Copy)]
pub struct DelegateCreationArgs {
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Copy)]
pub struct DelegateCloseArgs {
    pub account_meta: CompressedAccountMetaClose,
    pub data: Delegate,
}

#[derive(PartialEq)]
pub enum DelegateOp {
    Create(MemberWithCreationArgs),
    Close(MemberKeyWithCloseArgs),
}

impl Delegate {
    pub fn create_delegate_account<'info>(
        delegate_creation_args: Option<DelegateCreationArgs>,
        member: &MemberKey,
        settings_index: u128,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<(CompressedAccountInfo, NewAddressParamsPacked)> {
        let delegate_args = delegate_creation_args.ok_or(MultisigError::MissingDelegateArgs)?;
        let (address, address_seed) = derive_address(
            &[SEED_DELEGATE, member.get_seed().as_ref()],
            &delegate_args
                .address_tree_info
                .get_tree_pubkey(light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
            &crate::ID,
        );

        let new_address_params = delegate_args
            .address_tree_info
            .into_new_address_params_packed(address_seed);

        let mut delegate_account = LightAccount::<'_, Delegate>::new_init(
            &crate::ID,
            Some(address),
            delegate_args.output_state_tree_index,
        );

        delegate_account.index = settings_index;

        Ok((
            delegate_account
                .to_account_info()
                .map_err(ProgramError::from)?,
            new_address_params,
        ))
    }

    fn close_delegate_account<'info>(
        delegate_close_args: Option<DelegateCloseArgs>,
    ) -> Result<CompressedAccountInfo> {
        let delegate_args = delegate_close_args.ok_or(MultisigError::MissingDelegateArgs)?;
        let delegate_account = LightAccount::<'_, Delegate>::new_close(
            &crate::ID,
            &delegate_args.account_meta,
            Delegate {
                index: delegate_args.data.index,
            },
        )
        .map_err(ProgramError::from)?;

        Ok(delegate_account
            .to_account_info()
            .map_err(ProgramError::from)?)
    }

    pub fn handle_delegate_accounts<'info>(
        delegate_ops: Vec<DelegateOp>,
        settings_index: u128,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<(
        Vec<(CompressedAccountInfo, NewAddressParamsPacked)>,
        Vec<CompressedAccountInfo>,
    )> {
        let mut net_ops: HashMap<MemberKey, Option<DelegateOp>> = HashMap::new();

        for op in delegate_ops {
            let key = match &op {
                DelegateOp::Create(pk) => pk.data.pubkey,
                DelegateOp::Close(pk) => pk.data,
            };
            match net_ops.get(&key) {
                Some(Some(prev)) if prev != &op => {
                    net_ops.insert(key, None); // cancel out
                }
                _ => {
                    net_ops.insert(key, Some(op));
                }
            }
        }
        let mut final_creates: Vec<MemberWithCreationArgs> = vec![];
        let mut final_closes: Vec<MemberKeyWithCloseArgs> = vec![];
        for action in net_ops.values().flatten() {
            match action {
                DelegateOp::Create(pk) => final_creates.push(pk.clone()),
                DelegateOp::Close(pk) => final_closes.push(pk.clone()),
            }
        }

        let mut final_create_args: Vec<(CompressedAccountInfo, NewAddressParamsPacked)> = vec![];
        let mut final_close_args: Vec<CompressedAccountInfo> = vec![];
        for pk in final_creates {
            final_create_args.push(Delegate::create_delegate_account(
                pk.delegate_args,
                &pk.data.pubkey,
                settings_index,
                &light_cpi_accounts,
            )?);
        }

        for pk in final_closes {
            final_close_args.push(Delegate::close_delegate_account(pk.delegate_args)?);
        }

        Ok((final_create_args, final_close_args))
    }
}

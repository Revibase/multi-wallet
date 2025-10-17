use crate::{
    MemberKey, MemberKeyWithRemovePermissionsArgs, MemberWithAddPermissionsArgs, MultisigError,
    SEED_DELEGATE, SEED_VERSION,
};
use anchor_lang::prelude::*;
use light_compressed_account::instruction_data::data::NewAddressParamsPacked;
use light_sdk::{
    address::v1::derive_address,
    cpi::v1::CpiAccounts,
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo},
    LightAccount, LightDiscriminator, LightHasherSha,
};

#[derive(
    Default,
    AnchorDeserialize,
    AnchorSerialize,
    LightDiscriminator,
    LightHasherSha,
    PartialEq,
    Debug,
)]
pub struct Delegate {
    pub member: MemberKey,
    pub domain_config: Option<Pubkey>,
    pub is_permanent_member: bool,
    pub settings_index: Option<u128>,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct DelegateCreationArgs {
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug)]
pub struct DelegateMutArgs {
    pub account_meta: CompressedAccountMeta,
    pub data: Delegate,
}

#[derive(PartialEq)]
pub enum Ops {
    Add(MemberWithAddPermissionsArgs),
    Remove(MemberKeyWithRemovePermissionsArgs),
}

impl Delegate {
    pub fn create_delegate_account<'info>(
        delegate_creation_args: DelegateCreationArgs,
        light_cpi_accounts: &CpiAccounts,
        delegate: Delegate,
    ) -> Result<(LightAccount<'info, Delegate>, NewAddressParamsPacked)> {
        let member_seed = delegate.member.get_seed()?;
        let (address, address_seed) = derive_address(
            &[SEED_DELEGATE, &member_seed, SEED_VERSION],
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

        delegate_account.member = delegate.member;
        delegate_account.settings_index = delegate.settings_index;
        delegate_account.domain_config = delegate.domain_config;
        delegate_account.is_permanent_member = delegate.is_permanent_member;

        Ok((delegate_account, new_address_params))
    }

    pub fn handle_delegate_accounts<'info>(
        delegate_ops: Vec<Ops>,
        settings_index: u128,
    ) -> Result<Vec<LightAccount<'info, Delegate>>> {
        let mut final_account_infos: Vec<LightAccount<'info, Delegate>> = vec![];

        for action in delegate_ops.into_iter() {
            match action {
                Ops::Remove(pk) => {
                    final_account_infos
                        .push(Delegate::remove_delegate(pk.delegate_args, settings_index)?);
                }
                Ops::Add(pk) => {
                    final_account_infos.push(Delegate::handle_add_delegate(
                        pk.delegate_args,
                        settings_index,
                        pk.set_as_delegate,
                    )?);
                }
            }
        }

        Ok(final_account_infos)
    }

    pub fn handle_add_delegate<'info>(
        delegate_mut_args: DelegateMutArgs,
        settings_index: u128,
        set_as_delegate: bool,
    ) -> Result<LightAccount<'info, Delegate>> {
        let mut delegate_account = LightAccount::<'_, Delegate>::new_mut(
            &crate::ID,
            &delegate_mut_args.account_meta,
            delegate_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        if delegate_account.is_permanent_member {
            require!(
                delegate_account.settings_index.is_none(),
                MultisigError::AlreadyDelegated
            );
        }

        if set_as_delegate {
            delegate_account.settings_index = Some(settings_index);
        }

        Ok(delegate_account)
    }

    fn remove_delegate<'info>(
        delegate_mut_args: DelegateMutArgs,
        settings_index: u128,
    ) -> Result<LightAccount<'info, Delegate>> {
        let mut delegate_account = LightAccount::<'_, Delegate>::new_mut(
            &crate::ID,
            &delegate_mut_args.account_meta,
            delegate_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        require!(
            !delegate_account.is_permanent_member,
            MultisigError::PermanentMember
        );

        if let Some(delegate_account_settings_index) = delegate_account.settings_index {
            if delegate_account_settings_index.eq(&settings_index) {
                delegate_account.settings_index = None;
            }
        }

        Ok(delegate_account)
    }
}

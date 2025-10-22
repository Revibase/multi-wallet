use crate::{
    MemberKey, MemberKeyWithRemovePermissionsArgs, MemberWithAddPermissionsArgs, MultisigError,
    SEED_USER, SEED_VERSION,
};
use anchor_lang::prelude::*;
use light_compressed_account::instruction_data::data::NewAddressParamsPacked;
use light_sdk::{
    address::v1::derive_address,
    cpi::v1::CpiAccounts,
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo},
    LightAccount, LightDiscriminator,
};

#[derive(Default, AnchorDeserialize, AnchorSerialize, LightDiscriminator, PartialEq, Debug)]
pub struct User {
    pub member: MemberKey,
    pub domain_config: Option<Pubkey>,
    pub is_permanent_member: bool,
    pub settings_index: Option<u128>,
    pub transaction_manager_url: Option<String>,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct UserCreationArgs {
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug)]
pub struct UserMutArgs {
    pub account_meta: CompressedAccountMeta,
    pub data: User,
}

#[derive(PartialEq)]
pub enum Ops {
    Add(MemberWithAddPermissionsArgs),
    Remove(MemberKeyWithRemovePermissionsArgs),
}

impl User {
    pub fn create_user_account<'info>(
        user_creation_args: UserCreationArgs,
        light_cpi_accounts: &CpiAccounts,
        user: User,
    ) -> Result<(LightAccount<'info, User>, NewAddressParamsPacked)> {
        let member_seed = user.member.get_seed()?;
        let (address, address_seed) = derive_address(
            &[SEED_USER, &member_seed, SEED_VERSION],
            &user_creation_args
                .address_tree_info
                .get_tree_pubkey(light_cpi_accounts)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
            &crate::ID,
        );

        let new_address_params = user_creation_args
            .address_tree_info
            .into_new_address_params_packed(address_seed);

        let mut user_account = LightAccount::<'_, User>::new_init(
            &crate::ID,
            Some(address),
            user_creation_args.output_state_tree_index,
        );

        user_account.member = user.member;
        user_account.settings_index = user.settings_index;
        user_account.domain_config = user.domain_config;
        user_account.is_permanent_member = user.is_permanent_member;
        user_account.transaction_manager_url = user.transaction_manager_url;

        Ok((user_account, new_address_params))
    }

    pub fn handle_user_delegates<'info>(
        delegate_ops: Vec<Ops>,
        settings_index: u128,
    ) -> Result<Vec<LightAccount<'info, User>>> {
        let mut final_account_infos: Vec<LightAccount<'info, User>> = vec![];

        for action in delegate_ops.into_iter() {
            match action {
                Ops::Remove(pk) => {
                    final_account_infos
                        .push(User::remove_delegate(pk.user_mut_args, settings_index)?);
                }
                Ops::Add(pk) => {
                    final_account_infos.push(User::handle_add_delegate(
                        pk.user_mut_args,
                        settings_index,
                        pk.set_as_delegate,
                    )?);
                }
            }
        }

        Ok(final_account_infos)
    }

    pub fn handle_add_delegate<'info>(
        user_mut_args: UserMutArgs,
        settings_index: u128,
        set_as_delegate: bool,
    ) -> Result<LightAccount<'info, User>> {
        let mut user_account = LightAccount::<'_, User>::new_mut(
            &crate::ID,
            &user_mut_args.account_meta,
            user_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        if user_account.is_permanent_member {
            require!(
                user_account.settings_index.is_none(),
                MultisigError::AlreadyDelegated
            );
        }

        if set_as_delegate {
            user_account.settings_index = Some(settings_index);
        }

        Ok(user_account)
    }

    fn remove_delegate<'info>(
        user_mut_args: UserMutArgs,
        settings_index: u128,
    ) -> Result<LightAccount<'info, User>> {
        let mut user_account = LightAccount::<'_, User>::new_mut(
            &crate::ID,
            &user_mut_args.account_meta,
            user_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        require!(
            !user_account.is_permanent_member,
            MultisigError::PermanentMember
        );

        if let Some(user_account_settings_index) = user_account.settings_index {
            if user_account_settings_index.eq(&settings_index) {
                user_account.settings_index = None;
            }
        }

        Ok(user_account)
    }
}

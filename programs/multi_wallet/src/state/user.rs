use crate::{
    error::MultisigError,
    state::{
        MemberKey, MemberKeyWithRemovePermissionsArgs, MemberWithAddPermissionsArgs, SEED_DELEGATE,
    },
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

#[derive(
    Default, AnchorDeserialize, AnchorSerialize, LightDiscriminator, LightHasher, PartialEq, Debug,
)]
pub struct User {
    #[hash]
    pub member: MemberKey,
    #[hash]
    pub domain_config: Option<Pubkey>,
    pub is_permanent_member: bool,
    pub settings_index: Option<u128>,
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
    Create(MemberWithAddPermissionsArgs),
    Close(MemberKeyWithRemovePermissionsArgs),
}

pub struct CreateUserArgs {
    pub member: MemberKey,
    pub is_permanent_member: bool,
}

impl User {
    pub fn create_user_account<'info>(
        user_creation_args: UserCreationArgs,
        light_cpi_accounts: &CpiAccounts,
        create_user_args: CreateUserArgs,
        domain_config: Option<Pubkey>,
        settings_index: Option<u128>,
    ) -> Result<(CompressedAccountInfo, NewAddressParamsPacked)> {
        let member_seed = create_user_args.member.get_seed();
        let (address, address_seed) = derive_address(
            &[SEED_DELEGATE, &member_seed],
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

        user_account.member = create_user_args.member;
        user_account.settings_index = settings_index;
        user_account.domain_config = domain_config;
        user_account.is_permanent_member = create_user_args.is_permanent_member;

        Ok((
            user_account.to_account_info().map_err(ProgramError::from)?,
            new_address_params,
        ))
    }

    #[inline(never)]
    pub fn handle_user_delegate_accounts<'info>(
        mut delegate_ops: Vec<Ops>,
        settings_index: u128,
    ) -> Result<Vec<CompressedAccountInfo>> {
        let mut final_account_infos: Vec<CompressedAccountInfo> = vec![];

        delegate_ops.sort_by_key(|op| match op {
            Ops::Close(_) => 0,
            Ops::Create(_) => 1,
        });

        for action in delegate_ops.into_iter() {
            match action {
                Ops::Close(pk) => {
                    final_account_infos.push(User::remove_user_delegate_account(
                        pk.user_args,
                        settings_index,
                    )?);
                }
                Ops::Create(pk) => {
                    final_account_infos.push(User::handle_set_user_delegate(
                        pk.user_args,
                        settings_index,
                        pk.set_as_delegate,
                    )?);
                }
            }
        }

        Ok(final_account_infos)
    }

    #[inline(never)]
    pub fn handle_set_user_delegate(
        user_mut_args: UserMutArgs,
        settings_index: u128,
        set_as_delegate: bool,
    ) -> Result<CompressedAccountInfo> {
        let mut user_account = LightAccount::<'_, User>::new_mut(
            &crate::ID,
            &user_mut_args.account_meta,
            user_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        if user_account.is_permanent_member {
            require!(
                user_account.settings_index.is_none(),
                MultisigError::UserAlreadyDelegated
            );
        }

        if set_as_delegate {
            user_account.settings_index = Some(settings_index);
        }

        Ok(user_account.to_account_info().map_err(ProgramError::from)?)
    }

    #[inline(never)]
    fn remove_user_delegate_account<'info>(
        user_mut_args: UserMutArgs,
        settings_index: u128,
    ) -> Result<CompressedAccountInfo> {
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

        Ok(user_account.to_account_info().map_err(ProgramError::from)?)
    }
}

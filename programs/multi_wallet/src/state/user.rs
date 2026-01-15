use crate::state::SettingsIndexWithAddress;
use crate::utils::{KeyType, UserRole};
use crate::{AddMemberArgs, MemberKey, MultisigError, RemoveMemberArgs, SEED_USER};
use anchor_lang::prelude::*;
use light_sdk::address::NewAddressParamsAssignedPacked;
use light_sdk::cpi::v2::CpiAccounts;
use light_sdk::instruction::account_meta::{CompressedAccountMeta, CompressedAccountMetaReadOnly};
use light_sdk::{
    account::LightAccount, address::v2::derive_address, instruction::PackedAddressTreeInfo,
    LightDiscriminator,
};

#[derive(Default, AnchorDeserialize, AnchorSerialize, LightDiscriminator, PartialEq, Debug)]
pub struct User {
    pub member: MemberKey,
    pub domain_config: Option<Pubkey>,
    pub role: UserRole,
    pub delegated_to: Option<SettingsIndexWithAddress>,
    pub transaction_manager_url: Option<String>,
    pub user_address_tree_index: u8,
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

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug)]
pub struct UserReadOnlyArgs {
    pub account_meta: CompressedAccountMetaReadOnly,
    pub data: User,
}

#[derive(AnchorDeserialize, AnchorSerialize, Debug, PartialEq)]
pub enum UserReadOnlyOrMutateArgs {
    Read(UserReadOnlyArgs),
    Mutate(UserMutArgs),
}

#[derive(PartialEq)]
pub enum Ops {
    Add(AddMemberArgs),
    Remove(RemoveMemberArgs),
}

impl User {
    pub fn invariant(&self) -> Result<()> {
        if self.role.eq(&UserRole::TransactionManager) {
            require!(
                self.transaction_manager_url.is_some(),
                MultisigError::InvalidTransactionManagerConfig
            );
            require!(
                self.member.get_type().eq(&KeyType::Ed25519),
                MultisigError::InvalidTransactionManagerConfig
            );
            require!(
                self.delegated_to.is_none(),
                MultisigError::InvalidTransactionManagerConfig
            );
        } else {
            require!(
                self.transaction_manager_url.is_none(),
                MultisigError::InvalidUserTransactionManagerConfig
            )
        }

        if self.role.eq(&UserRole::Administrator) {
            require!(
                self.delegated_to.is_none(),
                MultisigError::InvalidAdministratorConfig
            );
            require!(
                self.member.get_type().eq(&KeyType::Ed25519),
                MultisigError::InvalidAdministratorConfig
            );
            require!(
                self.domain_config.is_some(),
                MultisigError::InvalidAdministratorConfig
            );
        }

        if self.member.get_type().eq(&KeyType::Secp256r1) {
            require!(
                self.domain_config.is_some(),
                MultisigError::DomainConfigIsMissing
            );
            require!(
                self.role.eq(&UserRole::Member) || self.role.eq(&UserRole::PermanentMember),
                MultisigError::InvalidUserRole
            );
        }

        if self.role.eq(&UserRole::PermanentMember) {
            require!(
                self.member.get_type().eq(&KeyType::Secp256r1),
                MultisigError::InvalidUserRole
            );
            require!(self.delegated_to.is_some(), MultisigError::InvalidUserRole);
        }
        Ok(())
    }

    pub fn create_user_account(
        user_creation_args: UserCreationArgs,
        address_tree: &Pubkey,
        user: User,
        index: Option<u8>,
    ) -> Result<(LightAccount<User>, NewAddressParamsAssignedPacked)> {
        let member_seed = user.member.get_seed()?;
        let (address, address_seed) =
            derive_address(&[SEED_USER, &member_seed], address_tree, &crate::ID);

        let new_address_params = user_creation_args
            .address_tree_info
            .into_new_address_params_assigned_packed(address_seed, index);

        let mut user_account = LightAccount::<User>::new_init(
            &crate::ID,
            Some(address),
            user_creation_args.output_state_tree_index,
        );

        user_account.member = user.member;
        user_account.delegated_to = user.delegated_to;
        user_account.domain_config = user.domain_config;
        user_account.role = user.role;
        user_account.transaction_manager_url = user.transaction_manager_url;

        Ok((user_account, new_address_params))
    }

    pub fn handle_user_delegates(
        delegate_ops: Vec<Ops>,
        settings_index_with_address: SettingsIndexWithAddress,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<Vec<LightAccount<User>>> {
        let mut final_account_infos: Vec<LightAccount<User>> = vec![];

        for action in delegate_ops.into_iter() {
            match action {
                Ops::Remove(pk) => {
                    final_account_infos.push(User::remove_delegate(
                        pk.user_args,
                        &settings_index_with_address,
                        light_cpi_accounts,
                    )?);
                }
                Ops::Add(pk) => {
                    final_account_infos.push(User::add_delegate(
                        pk.user_readonly_args,
                        light_cpi_accounts,
                    )?);
                }
            }
        }

        Ok(final_account_infos)
    }

    pub fn add_delegate(
        user_readonly_args: UserReadOnlyArgs,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<LightAccount<User>> {
        let user_account = LightAccount::<User>::new_read_only(
            &crate::ID,
            &user_readonly_args.account_meta,
            user_readonly_args.data,
            light_cpi_accounts
                .tree_pubkeys()
                .map_err(|_| MultisigError::MissingLightCpiAccounts)?
                .as_slice(),
        )
        .map_err(ProgramError::from)?;
        if user_account.role.eq(&UserRole::PermanentMember) {
            return err!(MultisigError::OnlyOnePermanentMemberAllowed);
        }
        Ok(user_account)
    }

    fn remove_delegate(
        user_args: UserReadOnlyOrMutateArgs,
        settings_index_with_address: &SettingsIndexWithAddress,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<LightAccount<User>> {
        match user_args {
            UserReadOnlyOrMutateArgs::Mutate(user_mut_args) => {
                let mut user_account = LightAccount::<User>::new_mut(
                    &crate::ID,
                    &user_mut_args.account_meta,
                    user_mut_args.data,
                )
                .map_err(ProgramError::from)?;

                require!(
                    user_account.role.ne(&UserRole::PermanentMember),
                    MultisigError::PermanentMember
                );

                if let Some(user_account_settings_index_with_address) = &user_account.delegated_to {
                    if user_account_settings_index_with_address.eq(&settings_index_with_address) {
                        user_account.delegated_to = None;
                    }
                }

                Ok(user_account)
            }
            UserReadOnlyOrMutateArgs::Read(user_readonly_args) => {
                let user_account = LightAccount::<User>::new_read_only(
                    &crate::ID,
                    &user_readonly_args.account_meta,
                    user_readonly_args.data,
                    light_cpi_accounts
                .tree_pubkeys()
                .map_err(|_| MultisigError::MissingLightCpiAccounts)?
                .as_slice(),
                )
                .map_err(ProgramError::from)?;

                require!(
                    user_account.role.ne(&UserRole::PermanentMember),
                    MultisigError::PermanentMember
                );

                if let Some(user_account_settings_index_with_address) = &user_account.delegated_to {
                    if user_account_settings_index_with_address.eq(&settings_index_with_address) {
                        return err!(MultisigError::MissingMutationUserArgs);
                    }
                }

                Ok(user_account)
            }
        }
    }
}

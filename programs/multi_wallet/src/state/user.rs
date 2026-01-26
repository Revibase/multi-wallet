use crate::state::SettingsIndexWithAddress;
use crate::utils::{KeyType, Transports, UserRole};
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
    pub domain_config: Option<Pubkey>,
    pub member: MemberKey,
    pub credential_id: Option<Vec<u8>>,
    pub transports: Option<Vec<Transports>>,
    pub wallets: Vec<SettingsIndexWithAddressAndDelegateInfo>,
    pub role: UserRole,
    pub transaction_manager_url: Option<String>,
    pub user_address_tree_index: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug)]
pub struct SettingsIndexWithAddressAndDelegateInfo {
    pub index: u128,
    pub settings_address_tree_index: u8,
    pub is_delegate: bool,
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
pub enum UserWalletOperation {
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
                self.wallets.is_empty(),
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
                self.wallets.is_empty(),
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
                self.credential_id.is_some(),
                MultisigError::CredentialIdIsMissing
            );
            require!(
                self.transports.is_some(),
                MultisigError::TransportsIsMissing
            );
            require!(
                self.role.eq(&UserRole::Member) || self.role.eq(&UserRole::PermanentMember),
                MultisigError::InvalidUserRole
            );
        }

        if self.member.get_type().eq(&KeyType::Ed25519) {
            require!(
                self.credential_id.is_none(),
                MultisigError::InvalidUserEd25519Config
            );
            require!(
                self.transports.is_none(),
                MultisigError::InvalidUserEd25519Config
            )
        }

        if self.role.eq(&UserRole::PermanentMember) {
            require!(
                self.member.get_type().eq(&KeyType::Secp256r1),
                MultisigError::InvalidUserRole
            );
            require!(
                self.wallets.len() == 1 && self.wallets[0].is_delegate,
                MultisigError::InvalidUserRole
            );
        }

        require!(
            self.wallets.iter().filter(|f| f.is_delegate).count() <= 1,
            MultisigError::AlreadyDelegated
        );

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

        user_account.transports = user.transports;
        user_account.credential_id = user.credential_id;
        user_account.member = user.member;
        user_account.wallets = user.wallets;
        user_account.domain_config = user.domain_config;
        user_account.role = user.role;
        user_account.transaction_manager_url = user.transaction_manager_url;

        Ok((user_account, new_address_params))
    }

    pub fn process_user_wallet_operations(
        wallet_operations: Vec<UserWalletOperation>,
        settings_index_with_address: SettingsIndexWithAddress,
        light_cpi_accounts: &CpiAccounts,
    ) -> Result<Vec<LightAccount<User>>> {
        let mut final_account_infos: Vec<LightAccount<User>> = vec![];

        for operation in wallet_operations.into_iter() {
            match operation {
                UserWalletOperation::Remove(pk) => {
                    final_account_infos.push(User::remove_wallet_from_user(
                        pk.user_args,
                        &settings_index_with_address,
                        light_cpi_accounts,
                    )?);
                }
                UserWalletOperation::Add(pk) => {
                    final_account_infos.push(User::add_wallet_to_user(
                        pk.user_args,
                        &settings_index_with_address,
                        light_cpi_accounts,
                    )?);
                }
            }
        }

        Ok(final_account_infos)
    }

    /// Adds a wallet to a user's wallet list when the user is added as a member to a wallet.
    ///
    /// This function is called during delegate operations (adding members to wallets).
    /// Note: This function does NOT set the `is_delegate` flag to true. The delegate flag is managed
    /// separately in the settings member struct. For `Member` role users, this function
    /// adds the wallet with `is_delegate: false`. The actual delegate status is determined
    /// by the settings member's `is_delegate` field.
    ///
    /// # Arguments
    /// * `user_args` - User account arguments (read-only or mutable)
    /// * `settings_index_with_address` - The wallet being added to the user
    /// * `light_cpi_accounts` - Light protocol CPI accounts for compressed account operations
    ///
    /// # Returns
    /// The updated user account
    ///
    /// # Errors
    /// * `OnlyOnePermanentMemberAllowed` - PermanentMember role cannot use this function
    /// * `MissingMutationUserArgs` - Member role requires mutable user args
    pub fn add_wallet_to_user(
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
                    MultisigError::OnlyOnePermanentMemberAllowed
                );

                if user_account.role.eq(&UserRole::Member) {
                    user_account
                        .wallets
                        .push(SettingsIndexWithAddressAndDelegateInfo {
                            index: settings_index_with_address.index,
                            settings_address_tree_index: settings_index_with_address
                                .settings_address_tree_index,
                            is_delegate: false,
                        });
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
                    MultisigError::OnlyOnePermanentMemberAllowed
                );

                require!(
                    user_account.role.ne(&UserRole::Member),
                    MultisigError::MissingMutationUserArgs
                );

                Ok(user_account)
            }
        }
    }

    /// Removes a wallet from a user's wallet list when the user is removed as a member from a wallet.
    ///
    /// # Arguments
    /// * `user_args` - User account arguments (read-only or mutable)
    /// * `settings_index_with_address` - The wallet being removed from the user
    /// * `light_cpi_accounts` - Light protocol CPI accounts for compressed account operations
    ///
    /// # Returns
    /// The updated user account
    ///
    /// # Errors
    /// * `PermanentMember` - PermanentMember role cannot have wallets removed
    /// * `MissingMutationUserArgs` - Member role requires mutable user args when wallet exists
    fn remove_wallet_from_user(
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

                user_account.wallets.retain(|f| {
                    f.index.ne(&settings_index_with_address.index)
                        || f.settings_address_tree_index
                            .ne(&settings_index_with_address.settings_address_tree_index)
                });

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

                require!(
                    user_account.wallets.iter().all(|f| {
                        f.index.ne(&settings_index_with_address.index)
                            || f.settings_address_tree_index
                                .ne(&settings_index_with_address.settings_address_tree_index)
                    }),
                    MultisigError::MissingMutationUserArgs
                );

                Ok(user_account)
            }
        }
    }
}

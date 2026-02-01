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

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_ed25519_member_key(idx: u8) -> MemberKey {
        let mut bytes = [0u8; 32];
        bytes[..].fill(idx);
        let pubkey = Pubkey::new_from_array(bytes);
        MemberKey::convert_ed25519(&pubkey).unwrap()
    }

    fn mk_secp256r1_member_key(idx: u8) -> MemberKey {
        let mut key = [0u8; 33];
        key[0] = KeyType::Secp256r1 as u8;
        key[1..].fill(idx);
        MemberKey { key_type: key[0], key }
    }

    #[test]
    fn test_invariant_transaction_manager_valid() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![],
            role: UserRole::TransactionManager,
            transaction_manager_url: Some("https://tm.example.com".to_string()),
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_ok());
    }

    #[test]
    fn test_invariant_transaction_manager_missing_url() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![],
            role: UserRole::TransactionManager,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_transaction_manager_secp256r1_fails() {
        let user = User {
            domain_config: None,
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::TransactionManager,
            transaction_manager_url: Some("https://tm.example.com".to_string()),
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_transaction_manager_has_wallets() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![SettingsIndexWithAddressAndDelegateInfo {
                index: 0,
                settings_address_tree_index: 0,
                is_delegate: false,
            }],
            role: UserRole::TransactionManager,
            transaction_manager_url: Some("https://tm.example.com".to_string()),
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_non_tm_with_url_fails() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: Some("https://tm.example.com".to_string()),
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_member_valid() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_ok());
    }

    #[test]
    fn test_invariant_administrator_valid() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![],
            role: UserRole::Administrator,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_ok());
    }

    #[test]
    fn test_invariant_administrator_with_wallets() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![SettingsIndexWithAddressAndDelegateInfo {
                index: 0,
                settings_address_tree_index: 0,
                is_delegate: false,
            }],
            role: UserRole::Administrator,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_administrator_secp256r1_fails() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::Administrator,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_administrator_no_domain_config() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![],
            role: UserRole::Administrator,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_secp256r1_member_valid() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_ok());
    }

    #[test]
    fn test_invariant_secp256r1_missing_domain_config() {
        let user = User {
            domain_config: None,
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_secp256r1_missing_credential_id() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: None,
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_secp256r1_missing_transports() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: None,
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_secp256r1_administrator_fails() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::Administrator,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_ed25519_with_credential_fails() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: None,
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_ed25519_with_transports_fails() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_permanent_member_valid() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![SettingsIndexWithAddressAndDelegateInfo {
                index: 0,
                settings_address_tree_index: 0,
                is_delegate: true,
            }],
            role: UserRole::PermanentMember,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_ok());
    }

    #[test]
    fn test_invariant_permanent_member_ed25519_fails() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![SettingsIndexWithAddressAndDelegateInfo {
                index: 0,
                settings_address_tree_index: 0,
                is_delegate: true,
            }],
            role: UserRole::PermanentMember,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_permanent_member_wrong_wallets() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![SettingsIndexWithAddressAndDelegateInfo {
                index: 0,
                settings_address_tree_index: 0,
                is_delegate: false,
            }],
            role: UserRole::PermanentMember,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_permanent_member_empty_wallets() {
        let user = User {
            domain_config: Some(Pubkey::new_unique()),
            member: mk_secp256r1_member_key(1),
            credential_id: Some(vec![1, 2, 3]),
            transports: Some(vec![Transports::Usb]),
            wallets: vec![],
            role: UserRole::PermanentMember,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_already_delegated() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![
                SettingsIndexWithAddressAndDelegateInfo {
                    index: 0,
                    settings_address_tree_index: 0,
                    is_delegate: true,
                },
                SettingsIndexWithAddressAndDelegateInfo {
                    index: 1,
                    settings_address_tree_index: 0,
                    is_delegate: true,
                },
            ],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_err());
    }

    #[test]
    fn test_invariant_member_with_wallet_valid() {
        let user = User {
            domain_config: None,
            member: mk_ed25519_member_key(1),
            credential_id: None,
            transports: None,
            wallets: vec![SettingsIndexWithAddressAndDelegateInfo {
                index: 0,
                settings_address_tree_index: 0,
                is_delegate: false,
            }],
            role: UserRole::Member,
            transaction_manager_url: None,
            user_address_tree_index: 0,
        };
        assert!(user.invariant().is_ok());
    }
}

use crate::utils::{resize_account_if_necessary, KeyType, Transports, UserRole};
use crate::{AddMemberArgs, MemberKey, MultisigError, RemoveMemberArgs, ID, SEED_USER};
use anchor_lang::prelude::*;

#[account]
pub struct User {
    pub domain_config: Option<Pubkey>,
    pub member: MemberKey,
    pub credential_id: Option<Vec<u8>>,
    pub transports: Option<Vec<Transports>>,
    pub wallets: Vec<SettingsIndexWithDelegateInfo>,
    pub role: UserRole,
    pub transaction_manager_url: Option<String>,
    pub bump: u8,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug, Clone, InitSpace)]
pub struct SettingsIndexWithDelegateInfo {
    pub index: u128,
    pub is_delegate: bool,
}

#[derive(PartialEq)]
pub enum UserWalletOperation {
    Add(AddMemberArgs),
    Remove(RemoveMemberArgs),
}

impl User {
    pub fn size(
        credential_id_len: usize,
        transports_len: usize,
        transaction_manager_url_len: usize,
        wallets_len: usize,
    ) -> usize {
        8                                   // discriminator
        + 1 + 32                            // optional domain config
        + 34                                // member key
        + 1 + 4 + credential_id_len         // optional credential id
        + 1 + 4 + transports_len            // optional transports
        + 4 + (wallets_len * SettingsIndexWithDelegateInfo::INIT_SPACE) // list of settings index with delegate info
        + 1                                 // user role
        + 1 + 4 + transaction_manager_url_len   // transaction manager url
        + 1 //bump
    }

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

    pub fn process_user_wallet_operations<'info>(
        wallet_operations: Vec<UserWalletOperation>,
        settings_index: u128,
        payer: &AccountInfo<'info>,
        system_program: &AccountInfo<'info>,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        for operation in wallet_operations.into_iter() {
            match operation {
                UserWalletOperation::Remove(pk) => {
                    User::remove_wallet_from_user(pk, settings_index, remaining_accounts)?;
                }
                UserWalletOperation::Add(pk) => {
                    User::add_wallet_to_user(
                        pk,
                        settings_index,
                        payer,
                        system_program,
                        remaining_accounts,
                    )?;
                }
            }
        }

        Ok(())
    }

    fn add_wallet_to_user<'info>(
        args: AddMemberArgs,
        settings_index: u128,
        payer: &AccountInfo<'info>,
        system_program: &AccountInfo<'info>,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        let (user_account_pubkey, _) =
            Pubkey::find_program_address(&[SEED_USER, &args.member_key.get_seed()?], &ID);

        let user_account_info = remaining_accounts
            .iter()
            .find(|f| f.key == &user_account_pubkey)
            .ok_or(MultisigError::MissingAccount)?;

        let mut user = {
            let data = user_account_info.try_borrow_data()?;
            User::try_deserialize(&mut &data[..])?
        };

        require!(
            user.role != UserRole::PermanentMember,
            MultisigError::OnlyOnePermanentMemberAllowed
        );

        if user.role == UserRole::Member {
            user.wallets.push(SettingsIndexWithDelegateInfo {
                index: settings_index,
                is_delegate: false,
            });
        }

        let new_size = User::size(
            user.credential_id.as_ref().map_or(0, |f| f.len()),
            user.transports.as_ref().map_or(0, |f| f.len()),
            user.transaction_manager_url.as_ref().map_or(0, |f| f.len()),
            user.wallets.len(),
        );

        resize_account_if_necessary(user_account_info, payer, system_program, new_size)?;

        user.invariant()?;

        {
            let mut data = user_account_info.try_borrow_mut_data()?;
            user.try_serialize(&mut &mut data[..])?;
        }

        Ok(())
    }

    fn remove_wallet_from_user(
        args: RemoveMemberArgs,
        settings_index: u128,
        remaining_accounts: &[AccountInfo],
    ) -> Result<()> {
        let (user_account_pubkey, _) =
            Pubkey::find_program_address(&[SEED_USER, &args.member_key.get_seed()?], &ID);
        let user_account_info = remaining_accounts
            .iter()
            .find(|f| f.key.eq(&user_account_pubkey))
            .ok_or(MultisigError::MissingAccount)?;
        let mut data = user_account_info.try_borrow_mut_data()?;
        let mut user = User::try_deserialize(&mut &data[..])?;

        require!(
            user.role.ne(&UserRole::PermanentMember),
            MultisigError::PermanentMember
        );

        user.wallets.retain(|f| f.index.ne(&settings_index));

        user.invariant()?;
        user.try_serialize(&mut &mut data[..])?;

        Ok(())
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
        MemberKey {
            key_type: key[0],
            key,
        }
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            wallets: vec![SettingsIndexWithDelegateInfo {
                index: 0,
                is_delegate: false,
            }],
            role: UserRole::TransactionManager,
            transaction_manager_url: Some("https://tm.example.com".to_string()),
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            wallets: vec![SettingsIndexWithDelegateInfo {
                index: 0,
                is_delegate: false,
            }],
            role: UserRole::Administrator,
            transaction_manager_url: None,
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            bump: 0,
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
            wallets: vec![SettingsIndexWithDelegateInfo {
                index: 0,
                is_delegate: true,
            }],
            role: UserRole::PermanentMember,
            transaction_manager_url: None,
            bump: 0,
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
            wallets: vec![SettingsIndexWithDelegateInfo {
                index: 0,
                is_delegate: true,
            }],
            role: UserRole::PermanentMember,
            transaction_manager_url: None,
            bump: 0,
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
            wallets: vec![SettingsIndexWithDelegateInfo {
                index: 0,
                is_delegate: false,
            }],
            role: UserRole::PermanentMember,
            transaction_manager_url: None,
            bump: 0,
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
            bump: 0,
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
                SettingsIndexWithDelegateInfo {
                    index: 0,
                    is_delegate: true,
                },
                SettingsIndexWithDelegateInfo {
                    index: 1,
                    is_delegate: true,
                },
            ],
            role: UserRole::Member,
            transaction_manager_url: None,
            bump: 0,
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
            wallets: vec![SettingsIndexWithDelegateInfo {
                index: 0,
                is_delegate: false,
            }],
            role: UserRole::Member,
            transaction_manager_url: None,
            bump: 0,
        };
        assert!(user.invariant().is_ok());
    }
}

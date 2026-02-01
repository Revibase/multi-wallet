use crate::{
    KeyType, MultisigError, Permissions, Secp256r1Pubkey, Secp256r1VerifyArgs,
    COMPRESSED_PUBKEY_SERIALIZED_SIZE,
};
use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[derive(
    InitSpace,
    PartialEq,
    AnchorSerialize,
    AnchorDeserialize,
    Copy,
    Clone,
    Zeroable,
    Pod,
    Default,
    Debug,
)]
#[repr(C)]
pub struct Member {
    pub pubkey: MemberKey,
    pub role: u8,
    pub permissions: Permissions,
    pub user_address_tree_index: u8,
    pub is_delegate: u8,
}

#[derive(
    InitSpace,
    Eq,
    PartialEq,
    Hash,
    AnchorSerialize,
    AnchorDeserialize,
    Zeroable,
    Copy,
    Clone,
    Pod,
    Debug,
)]
#[repr(C)]
pub struct MemberKey {
    pub key_type: u8,
    pub key: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE],
}
impl Default for MemberKey {
    fn default() -> Self {
        Self {
            key_type: 0,
            key: [0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE],
        }
    }
}

impl MemberKey {
    pub fn new(key_type: KeyType, key: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE]) -> Result<Self> {
        let member_key = Self {
            key_type: key_type as u8,
            key,
        };
        Ok(member_key)
    }

    pub fn get_signer(
        key: &Option<Signer>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        instructions_sysvar: Option<&UncheckedAccount>,
    ) -> Result<MemberKey> {
        if let Some(pubkey) = key {
            return MemberKey::convert_ed25519(&pubkey.key());
        }

        if let Some(args) = secp256r1_verify_args {
            let pubkey = args.extract_public_key_from_instruction(instructions_sysvar)?;
            return MemberKey::convert_secp256r1(&pubkey);
        }

        Err(error!(MultisigError::NoSignerFound))
    }

    pub fn to_pubkey(&self) -> Result<Pubkey> {
        require!(
            self.get_type() == KeyType::Ed25519,
            MultisigError::InvalidMemberKeyFormat
        );
        Ok(Pubkey::new_from_array(
            self.key[1..]
                .try_into()
                .map_err(|_| MultisigError::InvalidMemberKeyFormat)?,
        ))
    }

    pub fn convert_ed25519(pubkey: &Pubkey) -> Result<MemberKey> {
        let mut padded = [0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE];
        padded[1..COMPRESSED_PUBKEY_SERIALIZED_SIZE].copy_from_slice(pubkey.as_ref());
        MemberKey::new(KeyType::Ed25519, padded)
    }

    pub fn convert_secp256r1(pubkey: &Secp256r1Pubkey) -> Result<MemberKey> {
        MemberKey::new(KeyType::Secp256r1, pubkey.to_bytes())
    }

    pub fn get_seed(&self) -> Result<[u8; 32]> {
        match KeyType::from(self.key_type) {
            KeyType::Ed25519 => self.key[1..]
                .try_into()
                .map_err(|_| error!(MultisigError::InvalidMemberKeyFormat)),
            KeyType::Secp256r1 => self.key[1..]
                .try_into()
                .map_err(|_| error!(MultisigError::InvalidMemberKeyFormat)),
        }
    }

    pub fn get_type(&self) -> KeyType {
        KeyType::from(self.key_type)
    }
}

impl AsRef<[u8]> for MemberKey {
    fn as_ref(&self) -> &[u8] {
        &self.key.as_ref()
    }
}

pub fn bool_to_u8_delegate(is_delegate: bool) -> u8 {
    if is_delegate {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{KeyType, Permission, Secp256r1Pubkey, UserRole};

    #[test]
    fn test_convert_ed25519_roundtrip() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        assert_eq!(member_key.get_type(), KeyType::Ed25519);
        let recovered = member_key.to_pubkey().unwrap();
        assert_eq!(recovered, pubkey);
    }

    #[test]
    fn test_convert_secp256r1_to_pubkey_fails() {
        let mut key_bytes = [0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE];
        key_bytes[0] = KeyType::Secp256r1 as u8;
        let secp_pubkey = Secp256r1Pubkey(key_bytes);
        let member_key = MemberKey::convert_secp256r1(&secp_pubkey).unwrap();
        assert_eq!(member_key.get_type(), KeyType::Secp256r1);
        assert!(member_key.to_pubkey().is_err());
    }

    #[test]
    fn test_get_seed_ed25519() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        let seed = member_key.get_seed().unwrap();
        assert_eq!(seed.len(), 32);
        assert_eq!(seed.as_slice(), pubkey.as_ref());
    }

    #[test]
    fn test_get_seed_secp256r1() {
        let key_bytes = [1u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE];
        let secp_pubkey = Secp256r1Pubkey(key_bytes);
        let member_key = MemberKey::convert_secp256r1(&secp_pubkey).unwrap();
        let seed = member_key.get_seed().unwrap();
        assert_eq!(seed.len(), 32);
    }

    #[test]
    fn test_member_key_new() {
        let pubkey = Pubkey::new_unique();
        let padded = {
            let mut p = [0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE];
            p[1..].copy_from_slice(pubkey.as_ref());
            p
        };
        let member_key = MemberKey::new(KeyType::Ed25519, padded).unwrap();
        assert_eq!(member_key.key_type, KeyType::Ed25519 as u8);
    }

    #[test]
    fn test_member_key_default() {
        let member_key = MemberKey::default();
        assert_eq!(member_key.key_type, 0);
        assert_eq!(member_key.key, [0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE]);
    }

    #[test]
    fn test_member_key_as_ref() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        let bytes: &[u8] = member_key.as_ref();
        assert_eq!(bytes.len(), COMPRESSED_PUBKEY_SERIALIZED_SIZE);
    }

    #[test]
    fn test_member_key_equality() {
        let pubkey = Pubkey::new_unique();
        let key1 = MemberKey::convert_ed25519(&pubkey).unwrap();
        let key2 = MemberKey::convert_ed25519(&pubkey).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_member_key_inequality() {
        let key1 = MemberKey::convert_ed25519(&Pubkey::new_unique()).unwrap();
        let key2 = MemberKey::convert_ed25519(&Pubkey::new_unique()).unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_member_struct_default() {
        let member = Member::default();
        assert_eq!(member.role, 0);
        assert_eq!(member.is_delegate, 0);
        assert_eq!(member.user_address_tree_index, 0);
    }

    #[test]
    fn test_member_struct_with_permissions() {
        let pubkey = Pubkey::new_unique();
        let member_key = MemberKey::convert_ed25519(&pubkey).unwrap();
        let perms = Permissions::from_permissions(vec![
            Permission::InitiateTransaction,
            Permission::VoteTransaction,
            Permission::ExecuteTransaction,
        ]);
        let member = Member {
            pubkey: member_key,
            role: UserRole::Member.to_u8(),
            permissions: perms,
            user_address_tree_index: 0,
            is_delegate: 0,
        };
        assert!(member.permissions.has(Permission::InitiateTransaction));
        assert!(member.permissions.has(Permission::VoteTransaction));
        assert!(member.permissions.has(Permission::ExecuteTransaction));
    }

    #[test]
    fn test_bool_to_u8_delegate() {
        assert_eq!(bool_to_u8_delegate(true), 1);
        assert_eq!(bool_to_u8_delegate(false), 0);
    }
}

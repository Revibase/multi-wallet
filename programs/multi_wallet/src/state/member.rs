use anchor_lang::prelude::*;
use bytemuck::Zeroable;

use crate::{
    error::MultisigError,
    state::{DelegateCloseArgs, DelegateCreationArgs},
};

use super::{Secp256r1Pubkey, Secp256r1VerifyArgs, COMPRESSED_PUBKEY_SERIALIZED_SIZE};

#[derive(
    InitSpace, Eq, PartialEq, Clone, Copy, Hash, AnchorSerialize, AnchorDeserialize, Debug,
)]
pub struct Member {
    pub pubkey: MemberKey,
    pub permissions: Permissions,
    pub domain_config: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub struct MemberWithCreationArgs {
    pub data: Member,
    pub verify_args: Option<Secp256r1VerifyArgs>,
    pub delegate_args: Option<DelegateCreationArgs>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub struct MemberKeyWithCloseArgs {
    pub data: MemberKey,
    pub delegate_args: Option<DelegateCloseArgs>,
}

#[derive(
    InitSpace, Eq, PartialEq, Clone, Copy, Hash, AnchorSerialize, AnchorDeserialize, Debug,
)]
pub struct MemberKey {
    pub key_type: u8,
    pub key: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE],
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct MemberKeyWithPermissionsArgs {
    pub pubkey: MemberKey,
    pub permissions: Permissions,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum KeyType {
    Ed25519 = 1 << 0,
    Secp256r1 = 1 << 1,
}

impl KeyType {
    pub fn from(value: u8) -> KeyType {
        if value == KeyType::Ed25519 as u8 {
            return KeyType::Ed25519;
        } else {
            return KeyType::Secp256r1;
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
    ) -> Result<MemberKey> {
        let signer = match key {
            Some(pubkey) => Some(MemberKey::convert_ed25519(&pubkey.key())?),
            None => match secp256r1_verify_args {
                Some(args) => Some(MemberKey::convert_secp256r1(&args.public_key)?),
                None => None,
            },
        };

        require!(signer.is_some(), MultisigError::NoSignerFound);
        Ok(signer.unwrap())
    }

    pub fn convert_ed25519(pubkey: &Pubkey) -> Result<MemberKey> {
        let mut padded = [0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE];
        padded[1..COMPRESSED_PUBKEY_SERIALIZED_SIZE].copy_from_slice(pubkey.as_ref());
        MemberKey::new(KeyType::Ed25519, padded)
    }

    pub fn convert_secp256r1(pubkey: &Secp256r1Pubkey) -> Result<MemberKey> {
        MemberKey::new(KeyType::Secp256r1, pubkey.to_bytes())
    }

    pub fn get_seed(&self) -> [u8; 32] {
        match KeyType::from(self.key_type) {
            KeyType::Ed25519 => self.key[1..].try_into().unwrap(),
            KeyType::Secp256r1 => self.key[1..].try_into().unwrap(),
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

#[derive(Clone, Copy)]
pub enum Permission {
    InitiateTransaction = 1 << 0,
    VoteTransaction = 1 << 1,
    ExecuteTransaction = 1 << 2,
    IsDelegate = 1 << 3,
}

/// Bitmask for permissions.
#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    Eq,
    PartialEq,
    Clone,
    Copy,
    Default,
    Debug,
    Hash,
    Zeroable,
)]
pub struct Permissions {
    pub mask: u8,
}

impl Permissions {
    pub fn from_vec(permissions: &[Permission]) -> Self {
        let mut mask = 0;
        for permission in permissions {
            mask |= *permission as u8;
        }
        Self { mask }
    }

    pub fn has(&self, permission: Permission) -> bool {
        self.mask & (permission as u8) != 0
    }
}

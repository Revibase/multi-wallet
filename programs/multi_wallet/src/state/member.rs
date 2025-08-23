use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

use crate::{
    error::MultisigError,
    state::{KeyType, Permissions, UserMutArgs},
};

use super::{Secp256r1Pubkey, Secp256r1VerifyArgs, COMPRESSED_PUBKEY_SERIALIZED_SIZE};

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
    pub permissions: Permissions,
    pub domain_config: Pubkey, // if none, value will be Pubkey::Default
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

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq)]
pub struct MemberWithAddPermissionsArgs {
    pub data: Member,
    pub verify_args: Option<Secp256r1VerifyArgs>,
    pub user_delegate_creation_args: Option<UserMutArgs>,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq)]
pub struct MemberKeyWithRemovePermissionsArgs {
    pub data: MemberKey,
    pub user_delegate_close_args: Option<UserMutArgs>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct MemberKeyWithEditPermissionsArgs {
    pub pubkey: MemberKey,
    pub permissions: Permissions,
    pub user_delegate_close_args: Option<UserMutArgs>,
    pub user_delegate_creation_args: Option<UserMutArgs>,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    EditPermissions(Vec<MemberKeyWithEditPermissionsArgs>),
    AddMembers(Vec<MemberWithAddPermissionsArgs>),
    RemoveMembers(Vec<MemberKeyWithRemovePermissionsArgs>),
    SetThreshold(u8),
}

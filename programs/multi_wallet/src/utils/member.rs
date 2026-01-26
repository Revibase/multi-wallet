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

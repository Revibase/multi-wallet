use anchor_lang::{prelude::*, solana_program::pubkey::PUBKEY_BYTES};
use bytemuck::Zeroable;

use crate::error::MultisigError;

use super::{Secp256r1VerifyArgs, SECP256R1_PUBLIC_KEY_LENGTH};

#[derive(InitSpace, Eq, PartialEq, Clone, Hash, AnchorSerialize, AnchorDeserialize)]
pub struct Member {
    pub pubkey: MemberKey,
    pub permissions: Permissions,
}

#[derive(InitSpace, Eq, PartialEq, Clone, Hash, AnchorSerialize, AnchorDeserialize)]
pub struct MemberKey {
    pub key_type: u8,
    #[max_len(SECP256R1_PUBLIC_KEY_LENGTH)]
    pub key: Vec<u8>,
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
    pub fn new(key_type: KeyType, key: Vec<u8>) -> Result<Self> {
        let member_key = Self {
            key_type: key_type as u8,
            key,
        };
        member_key.validate_type()?;
        Ok(member_key)
    }

    pub fn get_signer(
        key: &Option<Signer>,
        args: &Option<Secp256r1VerifyArgs>,
    ) -> Result<MemberKey> {
        let signer = match key {
            Some(pubkey) => Some(MemberKey::convert_ed25519(&pubkey.key())?),
            None => match &args {
                Some(args) => Some(MemberKey::convert_secp256r1(&args.pubkey)?),
                None => None,
            },
        };

        require!(signer.is_some(), MultisigError::UnauthorisedToModifyBuffer);
        Ok(signer.unwrap())
    }

    pub fn convert_ed25519(pubkey: &Pubkey) -> Result<MemberKey> {
        MemberKey::new(KeyType::Ed25519, pubkey.as_ref().to_vec())
    }

    pub fn convert_secp256r1(pubkey: &[u8; SECP256R1_PUBLIC_KEY_LENGTH]) -> Result<MemberKey> {
        MemberKey::new(KeyType::Secp256r1, pubkey.as_ref().to_vec())
    }

    pub fn get_seed(&self) -> &[u8] {
        match KeyType::from(self.key_type) {
            KeyType::Ed25519 => self.as_ref(),
            KeyType::Secp256r1 => &self.key[1..],
        }
    }

    pub fn get_type(&self) -> KeyType {
        KeyType::from(self.key_type)
    }

    pub fn validate_type(&self) -> Result<bool> {
        match KeyType::from(self.key_type) {
            KeyType::Ed25519 => require!(
                self.key.len() == PUBKEY_BYTES,
                MultisigError::PublicKeyLengthMismatch
            ),
            KeyType::Secp256r1 => require!(
                self.key.len() == SECP256R1_PUBLIC_KEY_LENGTH,
                MultisigError::PublicKeyLengthMismatch
            ),
        };
        Ok(true)
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
    /// Currently unused.
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

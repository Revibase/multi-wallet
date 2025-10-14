use anchor_lang::prelude::*;

pub const COMPRESSED_PUBKEY_SERIALIZED_SIZE: usize = 33;
pub const SIGNATURE_SERIALIZED_SIZE: usize = 64;
pub const SIGNATURE_OFFSETS_SERIALIZED_SIZE: usize = 14;
pub const SIGNATURE_OFFSETS_START: usize = 2;
pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct Secp256r1Signature(pub(crate) [u8; SIGNATURE_SERIALIZED_SIZE]);

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Eq, PartialEq, Hash, Debug)]
pub struct Secp256r1Pubkey(pub(crate) [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE]);

impl Secp256r1Pubkey {
    pub fn to_bytes(&self) -> [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] {
        self.0
    }
}

impl Default for Secp256r1Pubkey {
    fn default() -> Self {
        Secp256r1Pubkey([0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE])
    }
}

impl AsRef<[u8]> for Secp256r1Pubkey {
    fn as_ref(&self) -> &[u8] {
        &self.0[..]
    }
}

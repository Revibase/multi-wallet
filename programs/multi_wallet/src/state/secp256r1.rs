use super::{DomainConfig, TransactionActionType};
use crate::error::MultisigError;
use anchor_lang::{
    prelude::*,
    solana_program::{hash::hash, sysvar::instructions},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::Value;
use solana_secp256r1_program::Secp256r1SignatureOffsets;
use std::str::from_utf8;

#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct Secp256r1VerifyArgs {
    pub public_key: Secp256r1Pubkey,
    pub client_data_json: Vec<u8>,
    pub slot_number: u64,
    pub slot_hash: [u8; 32],
}

pub const COMPRESSED_PUBKEY_SERIALIZED_SIZE: usize = 33;
pub const SIGNATURE_SERIALIZED_SIZE: usize = 64;
pub const SIGNATURE_OFFSETS_SERIALIZED_SIZE: usize = 14;
pub const SIGNATURE_OFFSETS_START: usize = 2;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Secp256r1Signature(pub(crate) [u8; SIGNATURE_SERIALIZED_SIZE]);

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, Eq, PartialEq, Hash)]
pub struct Secp256r1Pubkey(pub(crate) [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE]);

impl Secp256r1Pubkey {
    pub fn to_bytes(&self) -> [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] {
        self.0
    }

    fn extract_webauthn_signed_message_from_instruction(
        instructions_sysvar: &UncheckedAccount,
        public_key: &Secp256r1Pubkey,
    ) -> Result<([u8; 32], [u8; 32])> {
        let instruction = instructions::get_instruction_relative(-1, instructions_sysvar)?;

        require!(
            instruction.program_id.eq(&solana_secp256r1_program::ID),
            MultisigError::InvalidSignedMessage
        );

        let num_signatures = instruction.data[0];

        for i in 0..num_signatures {
            let start = i
                .saturating_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE as u8)
                .saturating_add(SIGNATURE_OFFSETS_START as u8);

            // SAFETY:
            // - data[start..] is guaranteed to be >= size of Secp256r1SignatureOffsets
            // - Secp256r1SignatureOffsets is a POD type, so we can safely read it as an unaligned struct
            let offsets = unsafe {
                core::ptr::read_unaligned(instruction.data.as_ptr().add(start as usize)
                    as *const Secp256r1SignatureOffsets)
            };

            let public_key_offset = offsets.public_key_offset as usize;
            let public_key_end = public_key_offset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;

            let extracted_pubkey: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] = instruction.data
                [public_key_offset..public_key_end]
                .try_into()
                .unwrap();
            if public_key.0.eq(&extracted_pubkey) {
                let message_offset = offsets.message_data_offset as usize;
                let message_end = message_offset + offsets.message_data_size as usize;
                let message = &instruction.data[message_offset..message_end];

                let rp_id_hash: [u8; 32] = message[..32]
                    .try_into()
                    .map_err(|_| MultisigError::InvalidSignedMessage)?;

                let client_data_hash: [u8; 32] = message[37..]
                    .try_into()
                    .map_err(|_| MultisigError::InvalidSignedMessage)?;

                return Ok((rp_id_hash, client_data_hash));
            }
        }

        err!(MultisigError::InvalidSignedMessage)
    }

    fn decode_base64url(input: &str) -> Result<Vec<u8>> {
        Ok(URL_SAFE_NO_PAD
            .decode(input)
            .map_err(|_| MultisigError::InvalidJson)?)
    }

    fn parse_json_manual(json_str: &str) -> Result<(String, String, String)> {
        let parsed: Value =
            serde_json::from_str(json_str).map_err(|_| MultisigError::InvalidJson)?;

        let origin = parsed
            .get("origin")
            .and_then(Value::as_str)
            .ok_or(MultisigError::MissingOrigin)?
            .to_string();

        let challenge = parsed
            .get("challenge")
            .and_then(Value::as_str)
            .ok_or(MultisigError::MissingChallenge)?
            .to_string();

        let webauthn_type = parsed
            .get("type")
            .and_then(Value::as_str)
            .ok_or(MultisigError::MissingType)?
            .to_string();

        Ok((origin, challenge, webauthn_type))
    }

    fn verify_slot_hash<'info>(
        sysvar_slot_history: &Option<UncheckedAccount<'info>>,
        slot_number: u64,
        slot_hash: [u8; 32],
    ) -> Result<()> {
        let sysvar_slot_history = sysvar_slot_history
            .as_ref()
            .ok_or(MultisigError::MissingSysvarSlotHistory)?;

        let data = sysvar_slot_history
            .try_borrow_data()
            .map_err(|_| MultisigError::InvalidSysvarDataFormat)?;

        let num_slot_hashes = u64::from_le_bytes(
            data[..8]
                .try_into()
                .map_err(|_| MultisigError::InvalidSysvarDataFormat)?,
        );

        let first_slot = u64::from_le_bytes(
            data[8..16]
                .try_into()
                .map_err(|_| MultisigError::InvalidSysvarDataFormat)?,
        );

        let offset = first_slot
            .checked_sub(slot_number)
            .ok_or(MultisigError::SlotNumberNotFound)? as usize;

        if offset >= num_slot_hashes as usize {
            return err!(MultisigError::SlotNumberNotFound);
        }

        let pos = 8 + offset * 40;

        let slot = u64::from_le_bytes(
            data[pos..pos + 8]
                .try_into()
                .map_err(|_| MultisigError::InvalidSysvarDataFormat)?,
        );

        if slot != slot_number {
            return err!(MultisigError::SlotNumberNotFound);
        }

        let hash = &data[pos + 8..pos + 40];
        if hash == slot_hash.as_ref() {
            Ok(())
        } else {
            err!(MultisigError::SlotHashMismatch)
        }
    }

    pub fn verify_webauthn<'info>(
        secp256r1_verify_data: &Secp256r1VerifyArgs,
        sysvar_slot_history: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        key: &Pubkey,
        message_hash: &[u8; 32],
        action_type: TransactionActionType,
        instructions_sysvar: &Option<UncheckedAccount<'info>>,
    ) -> Result<()> {
        let domain_data = domain_config
            .as_ref()
            .ok_or(MultisigError::DomainConfigIsMissing)?
            .load()?;

        require!(
            domain_data.is_disabled.eq(&0),
            MultisigError::DomainConfigIsDisabled
        );

        Self::verify_slot_hash(
            sysvar_slot_history,
            secp256r1_verify_data.slot_number,
            secp256r1_verify_data.slot_hash,
        )?;

        let client_data_json_str = from_utf8(&secp256r1_verify_data.client_data_json)
            .map_err(|_| MultisigError::InvalidJson)?;

        let (origin, challenge, webauthn_type) = Self::parse_json_manual(&client_data_json_str)?;

        let domain_origin: &str =
            from_utf8(&domain_data.origin[..domain_data.origin_length as usize])
                .map_err(|_| MultisigError::InvalidJson)?;

        require!(origin.eq(&domain_origin), MultisigError::InvalidOrigin);

        require!(webauthn_type.eq("webauthn.get"), MultisigError::InvalidType);

        let mut buffer = vec![];
        buffer.extend_from_slice(action_type.to_bytes());
        buffer.extend_from_slice(key.as_ref());
        buffer.extend_from_slice(message_hash);
        buffer.extend_from_slice(secp256r1_verify_data.slot_hash.as_ref());
        let expected_challenge = hash(&buffer).to_bytes();

        let decoded_challenge = Self::decode_base64url(&challenge)?;

        require!(
            decoded_challenge.eq(&expected_challenge),
            MultisigError::InvalidChallenge
        );

        let instructions_sysvar = instructions_sysvar
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;

        let (rp_id_hash, client_data_hash) =
            Self::extract_webauthn_signed_message_from_instruction(
                instructions_sysvar,
                &secp256r1_verify_data.public_key,
            )?;

        require!(
            domain_data.rp_id_hash.eq(&rp_id_hash),
            MultisigError::InvalidSignedMessage
        );

        require!(
            client_data_hash.eq(&hash(&secp256r1_verify_data.client_data_json).to_bytes()),
            MultisigError::InvalidSignedMessage
        );

        Ok(())
    }
}

impl AsRef<[u8]> for Secp256r1Pubkey {
    fn as_ref(&self) -> &[u8] {
        &self.0[..]
    }
}

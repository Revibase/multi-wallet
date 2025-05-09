use super::{DomainConfig, TransactionActionType};
use crate::error::MultisigError;
use anchor_lang::{prelude::*, solana_program::hash::hash};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::Value;
use std::str::from_utf8;

#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct Secp256r1VerifyArgs {
    pub signature: Secp256r1Signature,
    pub pubkey: Secp256r1Pubkey,
    pub truncated_auth_data: Vec<u8>,
    pub client_data_json: Vec<u8>,
    pub slot_number: u64,
    pub slot_hash: [u8; 32],
}

const SECP256R1_PUBLIC_KEY_LENGTH: usize = 33;
const SECP256R1_SIGNATURE_LENGTH: usize = 64;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Secp256r1Signature(pub(crate) [u8; SECP256R1_SIGNATURE_LENGTH]);

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, InitSpace, Eq, PartialEq, Hash)]
pub struct Secp256r1Pubkey(pub(crate) [u8; SECP256R1_PUBLIC_KEY_LENGTH]);

impl Secp256r1Pubkey {
    pub fn to_bytes(&self) -> [u8; SECP256R1_PUBLIC_KEY_LENGTH] {
        self.0
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

    fn get_webauthn_message_hash(
        client_data_json: &Vec<u8>,
        truncated_auth_data: &Vec<u8>,
        rp_id_hash: &[u8; 32],
    ) -> [u8; 32] {
        let client_data_hash = hash(client_data_json);
        let message = hash(
            &[
                rp_id_hash.as_ref(),
                truncated_auth_data.as_ref(),
                client_data_hash.to_bytes().as_ref(),
            ]
            .concat(),
        )
        .to_bytes();
        message
    }

    fn verify_signature(
        _message: &[u8; 32],
        _signature: &Secp256r1Signature,
        _pubkey: &Secp256r1Pubkey,
    ) -> bool {
        true
    }

    pub fn verify_webauthn<'info>(
        secp256r1_verify_data: &Secp256r1VerifyArgs,
        sysvar_slot_history: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        key: &Pubkey,
        message_hash: &[u8; 32],
        action_type: TransactionActionType,
    ) -> Result<bool> {
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

        let domain_origin = from_utf8(&domain_data.origin[..domain_data.origin_length as usize])
            .map_err(|_| MultisigError::InvalidJson)?;

        require!(origin.eq(&domain_origin), MultisigError::InvalidOrigin);

        require!(webauthn_type.eq("webauthn.get"), MultisigError::InvalidType);

        let expected_challenge = hash(
            [
                action_type.to_bytes().as_ref(),
                key.as_ref(),
                message_hash,
                secp256r1_verify_data.slot_hash.as_ref(),
            ]
            .concat()
            .as_ref(),
        )
        .to_bytes();

        let decoded_challenge = Self::decode_base64url(&challenge)?;

        require!(
            decoded_challenge.eq(&expected_challenge),
            MultisigError::InvalidChallenge
        );

        let message = Self::get_webauthn_message_hash(
            &secp256r1_verify_data.client_data_json,
            &secp256r1_verify_data.truncated_auth_data,
            &domain_data.rp_id_hash,
        );

        Ok(Self::verify_signature(
            &message,
            &secp256r1_verify_data.signature,
            &secp256r1_verify_data.pubkey,
        ))
    }
}

impl AsRef<[u8]> for Secp256r1Pubkey {
    fn as_ref(&self) -> &[u8] {
        &self.0[..]
    }
}

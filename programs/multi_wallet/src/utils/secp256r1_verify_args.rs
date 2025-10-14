use crate::{
    DomainConfig, MultisigError, Secp256r1Pubkey, TransactionActionType,
    COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID, SIGNATURE_OFFSETS_SERIALIZED_SIZE,
    SIGNATURE_OFFSETS_START,
};
use anchor_lang::{
    prelude::*,
    solana_program::{hash::hash, sysvar::instructions},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::Value;
use std::str::from_utf8;

#[allow(dead_code)]
struct Secp256r1SignatureOffsets {
    pub signature_offset: u16,
    pub signature_instruction_index: u16,
    pub public_key_offset: u16,
    pub public_key_instruction_index: u16,
    pub message_data_offset: u16,
    pub message_data_size: u16,
    pub message_instruction_index: u16,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct Secp256r1VerifyArgs {
    pub index: u8,
    pub slot_number: u64,
    pub client_data_json: Vec<u8>,
}

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq)]
pub struct Secp256r1VerifyArgsWithDomainAddress {
    pub domain_config_key: Pubkey,
    pub verify_args: Secp256r1VerifyArgs,
}

pub struct ChallengeArgs {
    pub account: Pubkey,
    pub message_hash: [u8; 32],
    pub action_type: TransactionActionType,
}

impl Secp256r1VerifyArgs {
    fn decode_base64url(input: &str) -> Result<Vec<u8>> {
        Ok(URL_SAFE_NO_PAD
            .decode(input)
            .map_err(|_| MultisigError::InvalidJson)?)
    }

    fn parse_client_data_json(&self) -> Result<(String, String, String)> {
        let client_data_json_str =
            from_utf8(&self.client_data_json).map_err(|_| MultisigError::InvalidJson)?;

        let parsed: Value =
            serde_json::from_str(client_data_json_str).map_err(|_| MultisigError::InvalidJson)?;

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

    fn fetch_slot_hash<'info>(
        &self,
        sysvar_slot_history: &Option<UncheckedAccount<'info>>,
    ) -> Result<[u8; 32]> {
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
            .checked_sub(self.slot_number)
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

        if slot != self.slot_number {
            return err!(MultisigError::SlotNumberNotFound);
        }

        let hash = &data[pos + 8..pos + 40];

        Ok(hash
            .try_into()
            .map_err(|_| MultisigError::InvalidSysvarDataFormat)?)
    }

    fn extract_webauthn_signed_message_from_instruction(
        &self,
        instructions_sysvar: &UncheckedAccount,
    ) -> Result<([u8; 32], [u8; 32])> {
        let instruction = instructions::get_instruction_relative(-1, instructions_sysvar)?;

        require!(
            instruction.program_id.eq(&SECP256R1_PROGRAM_ID),
            MultisigError::InvalidSignedMessage
        );

        let num_signatures = instruction.data[0];

        require!(
            self.index < num_signatures,
            MultisigError::InvalidSignedMessage
        );

        let start: u8 = self
            .index
            .saturating_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE as u8)
            .saturating_add(SIGNATURE_OFFSETS_START as u8);

        let offsets = unsafe {
            core::ptr::read_unaligned(
                instruction.data.as_ptr().add(start as usize) as *const Secp256r1SignatureOffsets
            )
        };

        let message_offset = offsets.message_data_offset as usize;
        let message_end = message_offset + offsets.message_data_size as usize;
        let message = &instruction.data[message_offset..message_end];

        let rp_id_hash: [u8; 32] = message[..32]
            .try_into()
            .map_err(|_| MultisigError::InvalidSignedMessage)?;

        let client_data_hash: [u8; 32] = message[37..]
            .try_into()
            .map_err(|_| MultisigError::InvalidSignedMessage)?;

        Ok((rp_id_hash, client_data_hash))
    }

    pub fn extract_public_key_from_instruction(
        &self,
        instructions_sysvar: Option<&UncheckedAccount>,
    ) -> Result<Secp256r1Pubkey> {
        let instructions_sysvar = instructions_sysvar
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let instruction = instructions::get_instruction_relative(-1, instructions_sysvar)?;

        require!(
            instruction.program_id.eq(&SECP256R1_PROGRAM_ID),
            MultisigError::InvalidSignedMessage
        );

        let num_signatures = instruction.data[0];

        require!(
            self.index < num_signatures,
            MultisigError::InvalidSignedMessage
        );

        let start: u8 = self
            .index
            .saturating_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE as u8)
            .saturating_add(SIGNATURE_OFFSETS_START as u8);

        let offsets = unsafe {
            core::ptr::read_unaligned(
                instruction.data.as_ptr().add(start as usize) as *const Secp256r1SignatureOffsets
            )
        };

        let public_key_offset = offsets.public_key_offset as usize;
        let public_key_end = public_key_offset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;

        let extracted_pubkey: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] = instruction.data
            [public_key_offset..public_key_end]
            .try_into()
            .map_err(|_| MultisigError::InvalidSignedMessage)?;

        Ok(Secp256r1Pubkey(extracted_pubkey))
    }

    pub fn verify_webauthn<'info>(
        &self,
        sysvar_slot_history: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        instructions_sysvar: &UncheckedAccount<'info>,
        challenge_args: ChallengeArgs,
    ) -> Result<()> {
        let domain_data = domain_config
            .as_ref()
            .ok_or(MultisigError::DomainConfigIsMissing)?
            .load()?;

        require!(
            domain_data.is_disabled.eq(&0),
            MultisigError::DomainConfigIsDisabled
        );

        let slot_hash = self.fetch_slot_hash(sysvar_slot_history)?;

        let (origin, challenge, webauthn_type) = self.parse_client_data_json()?;

        let whitelisted_origins = domain_data.parse_origins()?;

        require!(
            whitelisted_origins.contains(&origin),
            MultisigError::InvalidOrigin
        );

        require!(webauthn_type.eq("webauthn.get"), MultisigError::InvalidType);

        let mut buffer = vec![];
        buffer.extend_from_slice(challenge_args.action_type.to_bytes());
        buffer.extend_from_slice(challenge_args.account.as_ref());
        buffer.extend_from_slice(&challenge_args.message_hash);
        buffer.extend_from_slice(&slot_hash);

        let expected_challenge = hash(&buffer).to_bytes();

        require!(
            Self::decode_base64url(&challenge)?.eq(&expected_challenge),
            MultisigError::InvalidChallenge
        );

        let (rp_id_hash, client_data_hash) =
            self.extract_webauthn_signed_message_from_instruction(instructions_sysvar)?;

        require!(
            domain_data.rp_id_hash.eq(&rp_id_hash),
            MultisigError::RpIdHashMismatch
        );

        let expected_client_data_hash = hash(&self.client_data_json).to_bytes();
        require!(
            client_data_hash.eq(&expected_client_data_hash),
            MultisigError::InvalidSignedMessage
        );

        Ok(())
    }
}

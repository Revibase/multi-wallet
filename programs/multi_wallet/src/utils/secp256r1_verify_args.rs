use crate::{
    utils::MemberKey, DomainConfig, MultisigError, Secp256r1Pubkey, TransactionActionType,
    COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID, SIGNATURE_OFFSETS_SERIALIZED_SIZE,
    SIGNATURE_OFFSETS_START,
};
use anchor_lang::{prelude::*, solana_program::sysvar::instructions};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use light_sdk::light_hasher::{Hasher, Sha256};

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

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct Secp256r1VerifyArgs {
    pub signed_message_index: u8,
    pub slot_number: u64,
    pub origin_index: u8,
    pub cross_origin: bool,
    pub truncated_client_data_json: Vec<u8>,
    pub client_and_device_hash: [u8; 32],
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

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, InitSpace)]
pub struct ExpectedSecp256r1Signers {
    pub member_key: MemberKey,
    pub message_hash: [u8; 32],
}

impl Secp256r1VerifyArgs {
    /// Safely reads signature offsets from instruction data with bounds checking
    fn read_signature_offsets(
        data: &[u8],
        signed_message_index: u8,
        _num_signatures: u8,
    ) -> Result<Secp256r1SignatureOffsets> {
        // Calculate offset start position
        let start = signed_message_index
            .saturating_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE as u8)
            .saturating_add(SIGNATURE_OFFSETS_START as u8);
        let start_usize = start as usize;
        let end_usize = start_usize
            .checked_add(SIGNATURE_OFFSETS_SERIALIZED_SIZE)
            .ok_or(MultisigError::InvalidSignatureOffsets)?;

        // Bounds check before unsafe read
        require!(
            end_usize <= data.len(),
            MultisigError::InvalidSignatureOffsets
        );

        // Verify struct size matches expected serialized size
        // Secp256r1SignatureOffsets has 7 u16 fields = 14 bytes
        const EXPECTED_STRUCT_SIZE: usize = core::mem::size_of::<Secp256r1SignatureOffsets>();
        require!(
            EXPECTED_STRUCT_SIZE == SIGNATURE_OFFSETS_SERIALIZED_SIZE,
            MultisigError::InvalidSignatureOffsets
        );

        // Safe unaligned read with bounds verified and size validated
        let offsets = unsafe {
            core::ptr::read_unaligned(
                data.as_ptr().add(start_usize) as *const Secp256r1SignatureOffsets
            )
        };

        Ok(offsets)
    }

    /// Validates and extracts message data from instruction with bounds checking
    fn extract_message_data<'a>(
        data: &'a [u8],
        offsets: &Secp256r1SignatureOffsets,
    ) -> Result<&'a [u8]> {
        let message_offset = offsets.message_data_offset as usize;
        let message_size = offsets.message_data_size as usize;
        let message_end = message_offset
            .checked_add(message_size)
            .ok_or(MultisigError::InvalidSignatureOffsets)?;

        // Bounds check
        require!(
            message_end <= data.len(),
            MultisigError::InvalidSignatureOffsets
        );

        // WebAuthn message must be at least 64 bytes (32 for rp_id_hash + 32 for client_data_hash)
        require!(message_size >= 64, MultisigError::InvalidSignatureOffsets);

        Ok(&data[message_offset..message_end])
    }

    /// Validates and extracts public key from instruction with bounds checking
    fn extract_public_key_data<'a>(
        data: &'a [u8],
        offsets: &Secp256r1SignatureOffsets,
    ) -> Result<&'a [u8]> {
        let public_key_offset = offsets.public_key_offset as usize;
        let public_key_end = public_key_offset
            .checked_add(COMPRESSED_PUBKEY_SERIALIZED_SIZE)
            .ok_or(MultisigError::InvalidSecp256r1PublicKey)?;

        // Bounds check
        require!(
            public_key_end <= data.len(),
            MultisigError::InvalidSecp256r1PublicKey
        );

        Ok(&data[public_key_offset..public_key_end])
    }

    // Taken from Webauthn Spec: https://w3c.github.io/webauthn/#ccdtostring
    fn ccd_to_string(value: &str, output: &mut Vec<u8>) {
        output.push(b'"');

        for ch in value.chars() {
            match ch {
                // Printable safe range (except " and \)
                '\u{0020}'..='\u{0021}' | '\u{0023}'..='\u{005B}' | '\u{005D}'..='\u{10FFFF}' => {
                    let mut buf = [0u8; 4];
                    let s = ch.encode_utf8(&mut buf);
                    output.extend_from_slice(s.as_bytes());
                }
                '"' => output.extend_from_slice(br#"\""#),
                '\\' => output.extend_from_slice(br#"\\"#),
                _ => {
                    // Write \uXXXX manually without format!
                    output.extend_from_slice(b"\\u");
                    let code = ch as u32;
                    let hex = [
                        Self::hex_digit((code >> 12) & 0xF),
                        Self::hex_digit((code >> 8) & 0xF),
                        Self::hex_digit((code >> 4) & 0xF),
                        Self::hex_digit(code & 0xF),
                    ];
                    output.extend_from_slice(&hex);
                }
            }
        }

        output.push(b'"');
    }

    /// Converts 0..=15 to lowercase ASCII hex
    #[inline]
    fn hex_digit(n: u32) -> u8 {
        match n {
            0..=9 => b'0' + (n as u8),
            10..=15 => b'a' + ((n as u8) - 10),
            _ => unreachable!(),
        }
    }

    /// Taken from Webauthn Spec: https://w3c.github.io/webauthn/#clientdatajson-verification
    fn generate_client_data_json(
        &self,
        expected_origin: &String,
        expected_challenge: [u8; 32],
    ) -> Result<Vec<u8>> {
        let mut result = Vec::new();
        // {"type":"webauthn.get"
        result.extend_from_slice(br#"{"type":"webauthn.get""#);
        // ,"challenge":...
        result.extend_from_slice(br#","challenge":"#);
        Self::ccd_to_string(&URL_SAFE_NO_PAD.encode(expected_challenge), &mut result);
        // ,"origin":...
        result.extend_from_slice(br#","origin":"#);
        Self::ccd_to_string(expected_origin, &mut result);
        // ,"crossOrigin":...
        if self.cross_origin {
            result.extend_from_slice(br#","crossOrigin":true"#);
        } else {
            result.extend_from_slice(br#","crossOrigin":false"#);
        }
        // add any additional fields
        if !self.truncated_client_data_json.is_empty() {
            result.push(b',');
            result.extend_from_slice(&self.truncated_client_data_json);
        }
        // close json
        result.push(b'}');

        Ok(result)
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

        require!(data.len() >= 8, MultisigError::InvalidSysvarDataFormat);

        let num_slot_hashes = u64::from_le_bytes(
            data[..8]
                .try_into()
                .map_err(|_| MultisigError::InvalidSysvarDataFormat)?,
        ) as usize;

        if num_slot_hashes == 0 {
            return err!(MultisigError::InvalidSysvarDataFormat);
        }

        // Binary search for the slot (entries are stored in descending order by slot)
        // Each entry is 40 bytes (8 bytes slot + 32 bytes hash), starting at offset 8
        let mut left = 0usize;
        let mut right = num_slot_hashes;

        while left < right {
            let mid = left + (right - left) / 2;

            let pos = 8usize
                .checked_add(
                    mid.checked_mul(40)
                        .ok_or(MultisigError::InvalidSysvarDataFormat)?,
                )
                .ok_or(MultisigError::InvalidSysvarDataFormat)?;

            require!(
                pos.checked_add(40)
                    .ok_or(MultisigError::InvalidSysvarDataFormat)?
                    <= data.len(),
                MultisigError::InvalidSysvarDataFormat
            );

            let slot = u64::from_le_bytes(
                data[pos..pos + 8]
                    .try_into()
                    .map_err(|_| MultisigError::InvalidSysvarDataFormat)?,
            );

            if slot == self.slot_number {
                // Found the slot - extract the hash
                let hash = &data[pos + 8..pos + 40];
                return Ok(hash
                    .try_into()
                    .map_err(|_| MultisigError::InvalidSysvarDataFormat)?);
            } else if slot > self.slot_number {
                // Target slot is older (lower number), search right half
                left = mid + 1;
            } else {
                // Target slot is newer (higher number), search left half
                right = mid;
            }
        }

        err!(MultisigError::SlotNumberNotFound)
    }

    fn extract_webauthn_signed_message_from_instruction(
        &self,
        instructions_sysvar: &UncheckedAccount,
        expected_secp256r1_signers: &[ExpectedSecp256r1Signers],
    ) -> Result<([u8; 32], [u8; 32])> {
        let instruction = instructions::get_instruction_relative(-1, instructions_sysvar)?;

        require!(
            instruction.program_id.eq(&SECP256R1_PROGRAM_ID),
            MultisigError::InvalidSecp256r1Instruction
        );

        let data = instruction.data.as_slice();

        let num_signatures = *data
            .get(0)
            .ok_or(MultisigError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            MultisigError::SignatureIndexOutOfBounds
        );

        // Use safe helper function to read offsets
        let offsets =
            Self::read_signature_offsets(data, self.signed_message_index, num_signatures)?;

        // Extract and validate message data
        let message = Self::extract_message_data(data, &offsets)?;

        // Verify expected signers if provided
        if !expected_secp256r1_signers.is_empty() {
            let public_key_bytes = Self::extract_public_key_data(data, &offsets)?;

            let extracted_pubkey = MemberKey::convert_secp256r1(&Secp256r1Pubkey(
                public_key_bytes
                    .try_into()
                    .map_err(|_| MultisigError::InvalidSecp256r1PublicKey)?,
            ))?;

            let extracted_message_hash = expected_secp256r1_signers
                .iter()
                .find(|f| f.member_key.eq(&extracted_pubkey))
                .ok_or(MultisigError::MalformedSignedMessage)?
                .message_hash;

            let computed_hash =
                Sha256::hash(message).map_err(|_| MultisigError::HashComputationFailed)?;

            require!(
                extracted_message_hash.eq(&computed_hash),
                MultisigError::ExpectedMessageHashMismatch
            );
        }

        // Extract rp_id_hash (first 32 bytes) and client_data_hash (last 32 bytes)
        // Message size is already validated to be >= 64 bytes in extract_message_data
        let rp_id_hash: [u8; 32] = message[..32]
            .try_into()
            .map_err(|_| MultisigError::InvalidSignatureOffsets)?;

        let client_data_hash: [u8; 32] = message[(message.len() - 32)..]
            .try_into()
            .map_err(|_| MultisigError::InvalidSignatureOffsets)?;

        Ok((rp_id_hash, client_data_hash))
    }

    pub fn extract_public_key_from_instruction(
        &self,
        instructions_sysvar: Option<&UncheckedAccount>,
    ) -> Result<Secp256r1Pubkey> {
        let instructions_sysvar = instructions_sysvar
            .as_ref()
            .ok_or(MultisigError::MissingInstructionsSysvar)?;
        let instruction = instructions::get_instruction_relative(-1, instructions_sysvar)?;

        require!(
            instruction.program_id.eq(&SECP256R1_PROGRAM_ID),
            MultisigError::InvalidSecp256r1Instruction
        );

        let data = instruction.data.as_slice();
        let num_signatures = *data
            .get(0)
            .ok_or(MultisigError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            MultisigError::SignatureIndexOutOfBounds
        );

        // Use safe helper function to read offsets
        let offsets =
            Self::read_signature_offsets(data, self.signed_message_index, num_signatures)?;

        // Extract and validate public key data
        let public_key_bytes = Self::extract_public_key_data(data, &offsets)?;

        let extracted_pubkey: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] = public_key_bytes
            .try_into()
            .map_err(|_| MultisigError::InvalidSecp256r1PublicKey)?;

        Ok(Secp256r1Pubkey(extracted_pubkey))
    }

    pub fn verify_webauthn<'info>(
        &self,
        sysvar_slot_history: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        instructions_sysvar: &UncheckedAccount<'info>,
        challenge_args: ChallengeArgs,
        expected_secp256r1_signers: &[ExpectedSecp256r1Signers],
    ) -> Result<()> {
        let domain_data = domain_config
            .as_ref()
            .ok_or(MultisigError::DomainConfigIsMissing)?
            .load()?;

        require!(
            domain_data.is_disabled.eq(&0),
            MultisigError::DomainConfigIsDisabled
        );

        let (rp_id_hash, client_data_hash) = self
            .extract_webauthn_signed_message_from_instruction(
                instructions_sysvar,
                expected_secp256r1_signers,
            )?;

        require!(
            domain_data.rp_id_hash.eq(&rp_id_hash),
            MultisigError::RpIdHashMismatch
        );

        let slot_hash = self.fetch_slot_hash(sysvar_slot_history)?;

        let whitelisted_origins = domain_data.parse_origins()?;
        let expected_origin = whitelisted_origins
            .get(self.origin_index as usize)
            .ok_or(MultisigError::OriginIndexOutOfBounds)?;

        let mut buffer = Vec::new();
        buffer.extend_from_slice(challenge_args.action_type.to_bytes());
        buffer.extend_from_slice(challenge_args.account.as_ref());
        buffer.extend_from_slice(&challenge_args.message_hash);
        buffer.extend_from_slice(&slot_hash);
        buffer.extend_from_slice(self.client_and_device_hash.as_ref());

        let expected_challenge =
            Sha256::hash(&buffer).map_err(|_| MultisigError::HashComputationFailed)?;

        let generated_client_data_json =
            self.generate_client_data_json(expected_origin, expected_challenge)?;

        let expected_client_data_hash = Sha256::hash(&generated_client_data_json)
            .map_err(|_| MultisigError::HashComputationFailed)?;

        if client_data_hash.ne(&expected_client_data_hash) {
            msg!(
                "Generated clientDataJSON ({} bytes): {:?}",
                generated_client_data_json.len(),
                &generated_client_data_json
            );
            return err!(MultisigError::ClientDataHashMismatch);
        }

        Ok(())
    }
}

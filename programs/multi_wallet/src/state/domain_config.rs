use crate::error::MultisigError;
use anchor_lang::prelude::*;
use std::str::from_utf8;

const MAX_ORIGIN_LEN: usize = 512;
pub const MAX_RP_ID_LEN: usize = u8::MAX as usize;

#[account(zero_copy)]
pub struct DomainConfig {
    pub num_origins: u16,
    pub authority: Pubkey,
    pub rp_id_hash: [u8; 32],
    pub bump: u8,
    pub is_disabled: u8,
    pub rp_id_length: u8,
    pub rp_id: [u8; MAX_RP_ID_LEN],
    pub origins: [u8; MAX_ORIGIN_LEN], // [origin_len, origin..., origin_len, origin...]
    pub padding: [u8; 2],
}

impl DomainConfig {
    pub fn size() -> usize {
        return 8 + 2 + 32 + 32 + 1 + 1 + 1 + MAX_RP_ID_LEN + MAX_ORIGIN_LEN + 2;
    }

    pub fn write_origins(&mut self, origins: Vec<String>) -> Result<()> {
        let mut cursor = 0;
        let mut count = 0;

        for origin in origins {
            let origin_bytes = origin.as_bytes();
            let origin_len = origin_bytes.len();

            // Total required space for this entry (2 bytes for length + string bytes)
            let entry_size = 2 + origin_len;
            if cursor + entry_size > MAX_ORIGIN_LEN {
                return err!(MultisigError::MaxLengthExceeded);
            }

            // Write length prefix
            let len_bytes = (origin_len as u16).to_le_bytes();
            self.origins[cursor] = len_bytes[0];
            self.origins[cursor + 1] = len_bytes[1];
            cursor += 2;

            // Write string bytes
            self.origins[cursor..cursor + origin_len].copy_from_slice(origin_bytes);
            cursor += origin_len;

            count += 1;
        }

        // Zero the remaining buffer to preserve consistency
        for i in cursor..MAX_ORIGIN_LEN {
            self.origins[i] = 0;
        }

        self.num_origins = count;

        Ok(())
    }

    pub fn parse_origins(&self) -> Result<Vec<String>> {
        let mut origins = Vec::with_capacity(self.num_origins as usize);
        let mut cursor = 0;

        for _ in 0..self.num_origins {
            if cursor + 2 > self.origins.len() {
                return err!(MultisigError::MaxLengthExceeded);
            }

            let len_bytes = [self.origins[cursor], self.origins[cursor + 1]];
            let str_len = u16::from_le_bytes(len_bytes) as usize;
            cursor += 2;

            if cursor + str_len > self.origins.len() {
                return err!(MultisigError::MaxLengthExceeded);
            }

            let str_bytes = &self.origins[cursor..cursor + str_len];
            match from_utf8(str_bytes) {
                Ok(s) => origins.push(s.to_string()),
                Err(_) => return err!(MultisigError::MaxLengthExceeded),
            }

            cursor += str_len;
        }

        Ok(origins)
    }
}

use crate::error::MultisigError;
use anchor_lang::prelude::*;
use std::str::from_utf8;

const MAX_ORIGINS_LEN: usize = 515;
const MAX_RP_ID_LEN: usize = u8::MAX as usize;

#[account(zero_copy)]
pub struct DomainConfig {
    pub authority: Pubkey,
    pub rp_id_hash: [u8; 32],
    pub bump: u8,
    pub is_disabled: u8,
    pub rp_id_length: u8,
    pub num_origins: u8,
    pub rp_id: [u8; MAX_RP_ID_LEN],
    pub origins: [u8; MAX_ORIGINS_LEN],
}

impl DomainConfig {
    pub fn size() -> usize {
        return 8 + 32 + 32 + 1 + 1 + 1 + 1 + MAX_RP_ID_LEN + MAX_ORIGINS_LEN;
    }

    pub fn write_rp_id(&mut self, rp_id: impl AsRef<str>) -> Result<()> {
        let rp_id = rp_id.as_ref().as_bytes();

        require!(
            rp_id.len() <= MAX_RP_ID_LEN,
            MultisigError::MaxLengthExceeded
        );

        self.rp_id_length = rp_id.len().try_into()?;

        for i in 0..MAX_RP_ID_LEN {
            if i < rp_id.len() {
                self.rp_id[i] = rp_id[i];
            } else {
                self.rp_id[i] = 0;
            }
        }
        Ok(())
    }

    pub fn write_origins(&mut self, origins: &[impl AsRef<str>]) -> Result<()> {
        let mut cursor = 0;
        let mut count = 0;

        for origin in origins {
            let origin = origin.as_ref();
            if origin.is_empty() {
                continue;
            }
            let origin_bytes = origin.as_bytes();
            let origin_len = origin_bytes.len();

            // Total required space for this entry (2 bytes for length + string bytes)
            let entry_size = 2 + origin_len;
            if cursor + entry_size > MAX_ORIGINS_LEN {
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
        for i in cursor..MAX_ORIGINS_LEN {
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

            // Validate string length is reasonable (prevent excessive memory allocation)
            require!(str_len <= MAX_ORIGINS_LEN, MultisigError::MaxLengthExceeded);

            let str_bytes = &self.origins[cursor..cursor + str_len];
            match from_utf8(str_bytes) {
                Ok(s) => origins.push(s.to_string()),
                Err(_) => return err!(MultisigError::MaxLengthExceeded),
            }

            cursor += str_len;
        }

        Ok(origins)
    }

    pub fn extract_domain_config_account<'a>(
        remaining_accounts: &'a [AccountInfo<'a>],
        domain_config_key: Pubkey,
    ) -> Result<AccountLoader<'a, DomainConfig>> {
        let domain_account = remaining_accounts
            .iter()
            .find(|f| f.key.eq(&domain_config_key))
            .ok_or(MultisigError::MissingAccount)?;
        let account_loader = AccountLoader::<DomainConfig>::try_from(domain_account)?;

        Ok(account_loader)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_domain_config() -> DomainConfig {
        DomainConfig {
            authority: Pubkey::new_unique(),
            rp_id_hash: [0u8; 32],
            bump: 0,
            is_disabled: 0,
            rp_id_length: 0,
            num_origins: 0,
            rp_id: [0u8; MAX_RP_ID_LEN],
            origins: [0u8; MAX_ORIGINS_LEN],
        }
    }

    #[test]
    fn test_write_and_parse_rp_id() {
        let mut config = create_test_domain_config();
        let rp_id = "example.com";
        config.write_rp_id(rp_id).unwrap();
        assert_eq!(config.rp_id_length, rp_id.len() as u8);
        let stored = std::str::from_utf8(&config.rp_id[..config.rp_id_length as usize]).unwrap();
        assert_eq!(stored, rp_id);
    }

    #[test]
    fn test_write_rp_id_empty() {
        let mut config = create_test_domain_config();
        config.write_rp_id("".to_string()).unwrap();
        assert_eq!(config.rp_id_length, 0);
    }

    #[test]
    fn test_write_rp_id_max_length() {
        let mut config = create_test_domain_config();
        let rp_id = "a".repeat(MAX_RP_ID_LEN);
        config.write_rp_id(rp_id.as_str()).unwrap();
        assert_eq!(config.rp_id_length, MAX_RP_ID_LEN as u8);
    }

    #[test]
    fn test_write_rp_id_exceeds_max_length() {
        let mut config = create_test_domain_config();
        let rp_id = "a".repeat(MAX_RP_ID_LEN + 1);
        assert!(config.write_rp_id(rp_id).is_err());
    }

    #[test]
    fn test_write_and_parse_origins_single() {
        let mut config = create_test_domain_config();
        let origins = vec!["https://example.com".to_string()];
        config.write_origins(origins.as_slice()).unwrap();
        let parsed = config.parse_origins().unwrap();
        assert_eq!(parsed, origins);
    }

    #[test]
    fn test_write_and_parse_origins_multiple() {
        let mut config = create_test_domain_config();
        let origins = vec![
            "https://example.com".to_string(),
            "https://app.example.com".to_string(),
            "https://test.example.com".to_string(),
        ];
        config.write_origins(origins.as_slice()).unwrap();
        let parsed = config.parse_origins().unwrap();
        assert_eq!(parsed, origins);
    }

    #[test]
    fn test_write_and_parse_origins_empty() {
        let mut config = create_test_domain_config();
        config.write_origins(&[] as &[&str]).unwrap();
        let parsed = config.parse_origins().unwrap();
        assert!(parsed.is_empty());
    }

    #[test]
    fn test_parse_origins_no_origins() {
        let config = create_test_domain_config();
        let parsed = config.parse_origins().unwrap();
        assert!(parsed.is_empty());
    }

    #[test]
    fn test_write_origins_overwrites_previous() {
        let mut config = create_test_domain_config();
        config
            .write_origins(&vec!["https://old.com".to_string()])
            .unwrap();
        config
            .write_origins(&vec!["https://new.com".to_string()])
            .unwrap();
        let parsed = config.parse_origins().unwrap();
        assert_eq!(parsed, vec!["https://new.com".to_string()]);
    }
}

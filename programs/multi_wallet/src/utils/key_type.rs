#[derive(PartialEq, Debug)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_type_from_ed25519() {
        assert_eq!(KeyType::from(KeyType::Ed25519 as u8), KeyType::Ed25519);
    }

    #[test]
    fn test_key_type_from_secp256r1() {
        assert_eq!(KeyType::from(KeyType::Secp256r1 as u8), KeyType::Secp256r1);
    }

    #[test]
    fn test_key_type_from_unknown_defaults_to_secp256r1() {
        assert_eq!(KeyType::from(0), KeyType::Secp256r1);
        assert_eq!(KeyType::from(255), KeyType::Secp256r1);
    }

    #[test]
    fn test_key_type_equality() {
        assert_eq!(KeyType::Ed25519, KeyType::Ed25519);
        assert_eq!(KeyType::Secp256r1, KeyType::Secp256r1);
        assert_ne!(KeyType::Ed25519, KeyType::Secp256r1);
    }

    #[test]
    fn test_key_type_values() {
        assert_eq!(KeyType::Ed25519 as u8, 1);
        assert_eq!(KeyType::Secp256r1 as u8, 2);
    }
}

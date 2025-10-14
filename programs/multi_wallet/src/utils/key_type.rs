#[derive(PartialEq)]
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

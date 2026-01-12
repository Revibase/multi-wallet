use anchor_lang::prelude::*;

#[derive(Default, AnchorDeserialize, AnchorSerialize, PartialEq, Clone, Copy, Debug)]
pub enum UserRole {
    #[default]
    Member,
    PermanentMember,
    TransactionManager,
    Administrator,
}

impl From<u8> for UserRole {
    fn from(value: u8) -> Self {
        match value {
            0 => UserRole::Member,
            1 => UserRole::PermanentMember,
            2 => UserRole::TransactionManager,
            3 => UserRole::Administrator,
            _ => UserRole::Member,
        }
    }
}

impl UserRole {
    pub fn to_u8(self) -> u8 {
        match self {
            UserRole::Member => 0,
            UserRole::PermanentMember => 1,
            UserRole::TransactionManager => 2,
            UserRole::Administrator => 3,
        }
    }
}

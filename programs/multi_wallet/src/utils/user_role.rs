use anchor_lang::prelude::*;

#[derive(Default, AnchorDeserialize, AnchorSerialize, PartialEq, Clone, Copy, Debug)]
pub enum UserRole {
    TransactionManager,
    Administrator,
    PermanentMember,
    #[default]
    Member,
}

impl From<u8> for UserRole {
    fn from(value: u8) -> Self {
        match value {
            0 => UserRole::TransactionManager,
            1 => UserRole::Administrator,
            2 => UserRole::PermanentMember,
            3 => UserRole::Member,
            _ => UserRole::Member,
        }
    }
}

impl UserRole {
    pub fn to_u8(self) -> u8 {
        match self {
            UserRole::TransactionManager => 0,
            UserRole::Administrator => 1,
            UserRole::PermanentMember => 2,
            UserRole::Member => 3,
        }
    }
}

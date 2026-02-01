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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_role_from_u8() {
        assert_eq!(UserRole::from(0), UserRole::TransactionManager);
        assert_eq!(UserRole::from(1), UserRole::Administrator);
        assert_eq!(UserRole::from(2), UserRole::PermanentMember);
        assert_eq!(UserRole::from(3), UserRole::Member);
        assert_eq!(UserRole::from(99), UserRole::Member); // unknown defaults to Member
    }

    #[test]
    fn test_user_role_to_u8() {
        assert_eq!(UserRole::TransactionManager.to_u8(), 0);
        assert_eq!(UserRole::Administrator.to_u8(), 1);
        assert_eq!(UserRole::PermanentMember.to_u8(), 2);
        assert_eq!(UserRole::Member.to_u8(), 3);
    }

    #[test]
    fn test_user_role_roundtrip() {
        for role in [
            UserRole::TransactionManager,
            UserRole::Administrator,
            UserRole::PermanentMember,
            UserRole::Member,
        ] {
            assert_eq!(UserRole::from(role.to_u8()), role);
        }
    }

    #[test]
    fn test_user_role_default() {
        let role = UserRole::default();
        assert_eq!(role, UserRole::Member);
    }

    #[test]
    fn test_user_role_equality() {
        assert_eq!(UserRole::Member, UserRole::Member);
        assert_ne!(UserRole::Member, UserRole::Administrator);
    }

    #[test]
    fn test_user_role_clone() {
        let role = UserRole::Administrator;
        let cloned = role.clone();
        assert_eq!(role, cloned);
    }

    #[test]
    fn test_user_role_copy() {
        let role = UserRole::PermanentMember;
        let copied = role;
        assert_eq!(role, copied);
    }
}

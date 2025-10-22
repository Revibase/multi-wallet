use crate::{Member, MemberKey, Permissions, Secp256r1VerifyArgs, UserMutArgs};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub enum DelegateOp {
    Add,
    Remove,
    Ignore,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct MemberWithAddPermissionsArgs {
    pub member: Member,
    pub verify_args: Option<Secp256r1VerifyArgs>,
    pub user_mut_args: UserMutArgs,
    pub set_as_delegate: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct MemberKeyWithRemovePermissionsArgs {
    pub member_key: MemberKey,
    pub user_mut_args: UserMutArgs,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct MemberKeyWithEditPermissionsArgs {
    pub member_key: MemberKey,
    pub permissions: Permissions,
    pub user_mut_args: Option<UserMutArgs>,
    pub delegate_operation: DelegateOp,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    EditPermissions(Vec<MemberKeyWithEditPermissionsArgs>),
    AddMembers(Vec<MemberWithAddPermissionsArgs>),
    RemoveMembers(Vec<MemberKeyWithRemovePermissionsArgs>),
    SetThreshold(u8),
}

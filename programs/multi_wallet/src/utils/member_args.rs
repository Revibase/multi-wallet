use crate::{DelegateMutArgs, Member, MemberKey, Permissions, Secp256r1VerifyArgs};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub enum DelegateOp {
    Add,
    Remove,
    Ignore,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq)]
pub struct MemberWithAddPermissionsArgs {
    pub member: Member,
    pub verify_args: Option<Secp256r1VerifyArgs>,
    pub delegate_args: DelegateMutArgs,
    pub set_as_delegate: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq)]
pub struct MemberKeyWithRemovePermissionsArgs {
    pub member_key: MemberKey,
    pub delegate_args: DelegateMutArgs,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub struct MemberKeyWithEditPermissionsArgs {
    pub member_key: MemberKey,
    pub permissions: Permissions,
    pub delegate_args: Option<DelegateMutArgs>,
    pub delegate_operation: DelegateOp,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    EditPermissions(Vec<MemberKeyWithEditPermissionsArgs>),
    AddMembers(Vec<MemberWithAddPermissionsArgs>),
    RemoveMembers(Vec<MemberKeyWithRemovePermissionsArgs>),
    SetThreshold(u8),
}

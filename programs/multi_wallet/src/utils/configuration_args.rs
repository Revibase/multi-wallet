use crate::{
    state::{UserMutArgs, UserReadOnlyOrMutateArgs},
    MemberKey, Permissions, Secp256r1VerifyArgs,
};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub enum DelegateOp {
    Add,
    Remove,
    Ignore,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct AddMemberArgs {
    pub member_key: MemberKey,
    pub permissions: Permissions,
    pub verify_args: Option<Secp256r1VerifyArgs>,
    pub user_args: UserReadOnlyOrMutateArgs,
    pub delegate_operation: DelegateOp,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct RemoveMemberArgs {
    pub member_key: MemberKey,
    pub user_args: UserReadOnlyOrMutateArgs,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct EditMemberArgs {
    pub member_key: MemberKey,
    pub permissions: Permissions,
    pub user_args: Option<UserMutArgs>,
    pub delegate_operation: DelegateOp,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    EditPermissions(Vec<EditMemberArgs>),
    AddMembers(Vec<AddMemberArgs>),
    RemoveMembers(Vec<RemoveMemberArgs>),
    SetThreshold(u8),
}

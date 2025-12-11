use crate::{state::UserMutArgs, MemberKey, Permissions, Secp256r1VerifyArgs};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct AddMemberArgs {
    pub member_key: MemberKey,
    pub permissions: Permissions,
    pub verify_args: Option<Secp256r1VerifyArgs>,
    pub user_mut_args: UserMutArgs,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct RemoveMemberArgs {
    pub member_key: MemberKey,
    pub user_mut_args: UserMutArgs,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug)]
pub struct EditMemberArgs {
    pub member_key: MemberKey,
    pub permissions: Permissions,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConfigAction {
    EditPermissions(Vec<EditMemberArgs>),
    AddMembers(Vec<AddMemberArgs>),
    RemoveMembers(Vec<RemoveMemberArgs>),
    SetThreshold(u8),
}

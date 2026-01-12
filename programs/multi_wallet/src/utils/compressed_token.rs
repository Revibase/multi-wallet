use anchor_lang::prelude::*;
use light_sdk::instruction::PackedMerkleContext;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CompressedTokenArgs {
    pub version: u8,
    pub root_index: u16,
    pub amount: u64,
    pub merkle_context: PackedMerkleContext,
}

#[derive(PartialEq)]
pub enum SourceType {
    CToken,
    Spl,
}

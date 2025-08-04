use crate::error::MultisigError;
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::instructions,
    system_program::{self},
};

pub fn durable_nonce_check<'info>(instructions_sysvar: &UncheckedAccount<'info>) -> Result<()> {
    let ix: anchor_lang::solana_program::instruction::Instruction =
        instructions::load_instruction_at_checked(0, instructions_sysvar)?;

    require!(
        !(ix.program_id == system_program::ID && ix.data.first() == Some(&4)),
        MultisigError::DurableNonceDetected
    );
    Ok(())
}

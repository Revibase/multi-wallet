use anchor_lang::{
    prelude::*,
    solana_program::sysvar::instructions,
    system_program::{self},
};

use crate::{error::MultisigError, id};

pub fn durable_nonce_check<'info>(instructions_sysvar: &UncheckedAccount<'info>) -> Result<()> {
    let ix: anchor_lang::solana_program::instruction::Instruction =
        instructions::load_instruction_at_checked(0, instructions_sysvar)?;

    require!(
        !(ix.program_id == system_program::ID && ix.data.first() == Some(&4)),
        MultisigError::DurableNonceDetected
    );
    Ok(())
}

/// Reallocates an account to a new size and ensures it maintains rent-exemption by transferring additional lamports if needed.
/// Returns an error if the system program or rent payer accounts are missing when additional lamports are required.
pub fn realloc_if_needed<'info>(
    account: &AccountInfo<'info>,
    old_size: usize,
    new_size: usize,
    rent_payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<bool> {
    require_keys_eq!(*account.owner, id(), MultisigError::IllegalAccountOwner);

    if new_size <= old_size {
        return Ok(false);
    }
    // Reallocate more space
    AccountInfo::resize(account, new_size)?;

    // Calculate if more lamports are needed for rent-exemption
    let rent_exempt_lamports = Rent::get().unwrap().minimum_balance(new_size).max(1);
    let top_up_lamports = rent_exempt_lamports.saturating_sub(account.lamports());

    if top_up_lamports > 0 {
        require_keys_eq!(
            *system_program.key,
            system_program::ID,
            MultisigError::InvalidAccount
        );

        system_program::transfer(
            CpiContext::new(
                system_program.to_account_info(),
                system_program::Transfer {
                    from: rent_payer.to_account_info(),
                    to: account.to_account_info(),
                },
            ),
            top_up_lamports,
        )?;
    }

    Ok(true)
}

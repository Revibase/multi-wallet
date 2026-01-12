use crate::error::MultisigError;
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::instructions,
    system_program::{self, transfer, Transfer},
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

pub fn resize_account_if_necessary<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    new_size: usize,
) -> Result<()> {
    let rent = Rent::get()?;
    let current_lamports = account.lamports();
    let target_lamports = rent.minimum_balance(new_size);
    if current_lamports < target_lamports {
        let top_up = target_lamports - current_lamports;
        transfer(
            CpiContext::new(
                system_program.to_account_info(),
                Transfer {
                    from: payer.to_account_info(),
                    to: account.to_account_info(),
                },
            ),
            top_up,
        )?;
        account.resize(new_size)?;
    }

    Ok(())
}

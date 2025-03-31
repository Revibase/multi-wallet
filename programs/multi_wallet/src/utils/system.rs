use anchor_lang::{prelude::*, system_program};

use crate::{error::MultisigError, id};

/// Closes an account by transferring all lamports to the `sol_destination`.
///
/// Lifted from private `anchor_lang::common::close`: https://github.com/coral-xyz/anchor/blob/714d5248636493a3d1db1481f16052836ee59e94/lang/src/common.rs#L6
pub fn close<'info>(info: AccountInfo<'info>, sol_destination: AccountInfo<'info>) -> Result<()> {
    // Transfer tokens from the account to the sol_destination.
    let dest_starting_lamports = sol_destination.lamports();
    **sol_destination.lamports.borrow_mut() =
        dest_starting_lamports.checked_add(info.lamports()).unwrap();
    **info.lamports.borrow_mut() = 0;

    info.assign(&system_program::ID);
    info.realloc(0, false).map_err(Into::into)
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
    AccountInfo::realloc(account, new_size, false)?;

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

/// Creates `new_account` via a CPI into SystemProgram.
/// Adapted from Anchor: https://github.com/coral-xyz/anchor/blob/714d5248636493a3d1db1481f16052836ee59e94/lang/syn/src/codegen/accounts/constraints.rs#L1126-L1179
pub fn create_account_if_none_exist<'a, 'info>(
    payer: &'a AccountInfo<'info>,
    new_account: &'a AccountInfo<'info>,
    system_program: &'a AccountInfo<'info>,
    owner_program: &Pubkey,
    space: usize,
    seeds: &[&[u8]],
) -> Result<()> {
    // Sanity checks
    require_keys_eq!(
        *system_program.key,
        system_program::ID,
        MultisigError::InvalidAccount
    );

    let current_lamports = **new_account.try_borrow_lamports()?;

    require!(current_lamports == 0, MultisigError::AccountAlreadyExist);
    let rent = Rent::get()?;
    anchor_lang::system_program::create_account(
        CpiContext::new(
            system_program.clone(),
            anchor_lang::system_program::CreateAccount {
                from: payer.clone(),
                to: new_account.clone(),
            },
        )
        .with_signer(&[seeds]),
        rent.minimum_balance(space),
        space as u64,
        owner_program,
    )
}

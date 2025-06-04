use anchor_lang::{
    prelude::*,
    solana_program::sysvar::instructions,
    system_program::{self},
};

use crate::{
    error::MultisigError,
    id,
    state::{Delegate, MemberKey, SEED_DELEGATE},
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
            system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: payer.to_account_info(),
                to: new_account.to_account_info(),
            },
        )
        .with_signer(&[seeds]),
        rent.minimum_balance(space),
        space as u64,
        owner_program,
    )
}

pub fn close_delegate_account<'a>(
    remaining_accounts: &[AccountInfo<'a>],
    payer: &Signer<'a>,
    member: &MemberKey,
) -> Result<()> {
    let seeds = &[SEED_DELEGATE, &member.get_seed()];
    let (delegate_account, _) = Pubkey::find_program_address(seeds, &id());
    let new_account = remaining_accounts
        .iter()
        .find(|f| f.key.eq(&delegate_account));
    require!(new_account.is_some(), MultisigError::MissingAccount);

    close(
        new_account.as_ref().unwrap().to_account_info(),
        payer.to_account_info(),
    )?;
    Ok(())
}

pub fn create_delegate_account<'a>(
    remaining_accounts: &'a [AccountInfo<'a>],
    payer: &Signer<'a>,
    system_program: &Program<'a, System>,
    multi_wallet_settings: Pubkey,
    member_key: &MemberKey,
) -> Result<()> {
    let seeds = &[SEED_DELEGATE, &member_key.get_seed()];
    let (delegate_account, bump) = Pubkey::find_program_address(seeds, &id());
    let new_account = remaining_accounts
        .iter()
        .find(|f| f.key.eq(&delegate_account));
    let account = new_account.ok_or(MultisigError::MissingAccount)?;

    create_account_if_none_exist(
        &payer.to_account_info(),
        account,
        &system_program.to_account_info(),
        &id(),
        Delegate::size(),
        &[SEED_DELEGATE, &member_key.get_seed(), &[bump]],
    )?;
    let mut delegate = account.data.borrow_mut();
    delegate[..8].copy_from_slice(&Delegate::DISCRIMINATOR);
    delegate[8] = bump;
    delegate[9..41].copy_from_slice(&multi_wallet_settings.to_bytes());

    Ok(())
}

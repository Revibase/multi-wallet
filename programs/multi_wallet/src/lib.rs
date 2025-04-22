#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

mod contexts;
mod error;
mod state;
mod utils;

use contexts::*;
use error::*;
use state::*;
use utils::*;

declare_id!("HomqiGa9FxngxAPbVEFzXM3pjicY5RbGCBu3dVNui3ry");

#[program]
pub mod multi_wallet {
    use super::*;

    /// Create the domain config needed for secp256r1 verification.
    ///
    /// # Parameters
    /// - `ctx`: The context of the domain config.
    ///
    /// # Returns
    /// - `Result<()>`: The result of the domain config creation.
    pub fn create_domain_config(
        ctx: Context<CreateDomainConfig>,
        args: CreateDomainConfigArgs,
    ) -> Result<()> {
        CreateDomainConfig::process(ctx, args)
    }

    /// Edit the domain config needed for secp256r1 verification.
    ///
    /// # Parameters
    /// - `ctx`: The context of the domain config.
    ///
    /// # Returns
    /// - `Result<()>`: The result of the domain config edit.
    pub fn edit_domain_config(
        ctx: Context<EditDomainConfig>,
        args: EditDomainConfigArgs,
    ) -> Result<()> {
        EditDomainConfig::process(ctx, args)
    }

    /// Delete the domain config needed for secp256r1 verification.
    ///
    /// # Parameters
    /// - `ctx`: The context of the domain config.
    ///
    /// # Returns
    /// - `Result<()>`: The result of the domain config Delete.
    pub fn delete_domain_config(ctx: Context<DeleteDomainConfig>) -> Result<()> {
        DeleteDomainConfig::process(ctx)
    }

    /// Creates a new multi-wallet.
    ///
    /// # Parameters
    /// - `ctx`: The context of the multi-wallet creation.
    /// - `initial_member`: The member key used to create the multi-wallet.
    /// - `metadata`: An optional metadata for the multi-wallet.
    /// - `label`: An optional label for the multi-wallet.
    ///
    /// # Returns
    /// - `Result<()>`: The result of the multi-wallet creation.
    pub fn create<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>,
        create_key: Pubkey,
        initial_members: Vec<MemberWithVerifyArgs>,
        metadata: Option<Pubkey>,
    ) -> Result<()> {
        CreateMultiWallet::process(ctx, create_key, initial_members, metadata)
    }

    /// # Parameters
    /// - `ctx`: The context of the multi-action execution.
    /// - `config_actions`: The list of actions to be executed.
    ///
    /// # Returns
    /// - `Result<()>`: The result of the multi-action execution.
    pub fn change_config<'info>(
        ctx: Context<'_, '_, 'info, 'info, ChangeConfig<'info>>,
        config_actions: Vec<ConfigAction>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        ChangeConfig::process(ctx, config_actions, secp256r1_verify_args)
    }

    /// Creates a new transaction buffer.
    ///
    /// # Parameters
    /// - `ctx`: Context containing all necessary accounts.
    /// - `args`: Arguments for the transaction buffer creation.
    ///
    /// # Returns
    /// - `Ok(())`: If the transaction buffer is successfully created.
    /// - `Err`: If validation fails or the provided arguments are invalid.
    pub fn transaction_buffer_create<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferCreate<'info>>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferCreate::process(ctx, args, secp256r1_verify_args)
    }

    /// Sign to approve a transaction buffer.
    ///
    /// # Parameters
    /// - `ctx`: Context containing all necessary accounts.
    /// - `args`: Arguments for the transaction buffer vote.
    ///
    /// # Returns
    /// - `Ok(())`: If the transaction buffer is successfully approved.
    /// - `Err`: If validation fails or the provided arguments are invalid.
    pub fn transaction_buffer_vote<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferVote<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferVote::process(ctx, secp256r1_verify_args)
    }

    /// Extends an existing transaction buffer.
    ///
    /// # Parameters
    /// - `ctx`: Context containing all necessary accounts.
    /// - `args`: Arguments for extending the transaction buffer.
    ///
    /// # Returns
    /// - `Ok(())`: If the transaction buffer is successfully extended.
    /// - `Err`: If validation fails or the provided arguments are invalid.
    pub fn transaction_buffer_extend<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExtend<'info>>,
        args: TransactionBufferExtendArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferExtend::process(ctx, args, secp256r1_verify_args)
    }

    /// Closes an existing transaction buffer.
    ///
    /// # Parameters
    /// - `ctx`: Context containing all necessary accounts.
    /// - `args`: Arguments for closing the transaction buffer.
    ///
    /// # Returns
    /// - `Ok(())`: If the transaction buffer is successfully closed.
    /// - `Err`: If validation fails or the accounts are invalid.
    pub fn transaction_buffer_close<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferClose<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferClose::process(ctx, secp256r1_verify_args)
    }

    /// Executes a transaction buffer.
    ///
    /// # Parameters
    /// - `ctx`: The context of the vault transaction execution.
    /// - `args`: Arguments for executing the vault transaction.
    ///
    /// # Returns
    /// - `Result<()>`: The result of the vault transaction execution.
    pub fn transaction_buffer_execute<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExecute<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferExecute::process(ctx, secp256r1_verify_args)
    }

    /// Executes a transaction synchronously.
    ///
    /// # Parameters
    /// - `ctx`: The context of the vault transaction execution.
    /// - `transaction_message`: The transaction message to be executed.
    /// - `args`: Arguments for executing the vault transaction.
    ///
    /// # Returns
    /// - `Result<()>`: The result of the vault transaction execution.
    pub fn transaction_execute_sync<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionExecuteSync<'info>>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionExecuteSync::process(ctx, transaction_message, secp256r1_verify_args)
    }
}

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

declare_id!("pkeyt2Txg77e2JSS2K44hDnC2p6uE4jXnd2UQZxZ2oE");

pub const ADMIN: Pubkey = pubkey!("G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF");

#[program]
pub mod multi_wallet {
    use super::*;

    /// Initializes a new domain configuration used for WebAuthn (secp256r1) verification.
    pub fn create_domain_config(
        ctx: Context<CreateDomainConfig>,
        args: CreateDomainConfigArgs,
    ) -> Result<()> {
        CreateDomainConfig::process(ctx, args)
    }

    /// Updates an existing domain configuration used for WebAuthn (secp256r1) verification.
    pub fn edit_domain_config(
        ctx: Context<EditDomainConfig>,
        args: EditDomainConfigArgs,
    ) -> Result<()> {
        EditDomainConfig::process(ctx, args)
    }

    /// Deletes an existing domain configuration used for WebAuthn (secp256r1) verification.
    pub fn delete_domain_config(ctx: Context<DeleteDomainConfig>) -> Result<()> {
        DeleteDomainConfig::process(ctx)
    }

    /// Enables or disables a domain configuration. Useful for temporary suspension.
    pub fn disable_domain_config(ctx: Context<DisableDomainConfig>, disable: bool) -> Result<()> {
        DisableDomainConfig::process(ctx, disable)
    }

    /// Creates a new multi-wallet with the specified permissions and ownership.
    pub fn create<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>,
        create_key: Pubkey,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        permissions: Permissions,
    ) -> Result<()> {
        CreateMultiWallet::process(ctx, create_key, secp256r1_verify_args, permissions)
    }

    /// Applies one or more configuration changes to an existing multi-wallet.
    pub fn change_config<'info>(
        ctx: Context<'_, '_, 'info, 'info, ChangeConfig<'info>>,
        config_actions: Vec<ConfigAction>,
    ) -> Result<()> {
        ChangeConfig::process(ctx, config_actions)
    }

    /// Creates a new transaction buffer to stage a transaction before execution.
    pub fn transaction_buffer_create<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferCreate<'info>>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferCreate::process(ctx, args, secp256r1_verify_args)
    }

    /// Signs a transaction buffer to register approval.
    pub fn transaction_buffer_vote<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferVote<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferVote::process(ctx, secp256r1_verify_args)
    }

    /// Extends an existing transaction buffer to allow for updated data or additional time.
    pub fn transaction_buffer_extend<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExtend<'info>>,
        args: TransactionBufferExtendArgs,
    ) -> Result<()> {
        TransactionBufferExtend::process(ctx, args)
    }

    /// Closes and cleans up a transaction buffer.
    pub fn transaction_buffer_close<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferClose<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferClose::process(ctx, secp256r1_verify_args)
    }

    /// Executes a previously approved transaction buffer.
    pub fn transaction_buffer_execute<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExecute<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferExecute::process(ctx, secp256r1_verify_args)
    }

    /// Executes a staged transaction from a buffer.
    pub fn transaction_execute<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionExecute<'info>>,
    ) -> Result<()> {
        TransactionExecute::process(ctx)
    }

    /// Executes a transaction synchronously by directly submitting the message and verifying it.
    pub fn transaction_execute_sync<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionExecuteSync<'info>>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionExecuteSync::process(ctx, transaction_message, secp256r1_verify_args)
    }

    /// Transfers SPL tokens using a signed transfer intent.
    pub fn token_transfer_intent<'info>(
        ctx: Context<'_, '_, '_, 'info, TokenTransferIntent<'info>>,
        amount: u64,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TokenTransferIntent::process(ctx, amount, secp256r1_verify_args)
    }

    /// Transfers SOL using a signed transfer intent.
    pub fn native_transfer_intent<'info>(
        ctx: Context<'_, '_, '_, 'info, NativeTransferIntent<'info>>,
        amount: u64,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        NativeTransferIntent::process(ctx, amount, secp256r1_verify_args)
    }
}

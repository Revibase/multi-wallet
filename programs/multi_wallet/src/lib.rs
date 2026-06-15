#![allow(unexpected_cfgs)]
mod error;
mod instructions;
mod state;
mod utils;

use anchor_lang::prelude::*;
use error::*;
use instructions::*;
use state::*;
use utils::*;

declare_id!("reviR1xysEChySVSWGa43a6oJ2boJYTJhwRjo8KJhhT");

pub const ADMIN: Pubkey = pubkey!("AMn21jT5RMZrv5hSvtkrWCMJFp3cUyeAx4AxKvF59xJZ");

#[program]
pub mod multi_wallet {

    use super::*;

    /// Initializes a new domain configuration used for WebAuthn (secp256r1) verification.
    #[instruction(discriminator = 0)]
    pub fn create_domain_config<'info>(
        ctx: Context<'info, CreateDomainConfig<'info>>,
        args: CreateDomainConfigArgs,
    ) -> Result<()> {
        CreateDomainConfig::process(ctx, args)
    }

    /// Updates an existing domain configuration used for WebAuthn (secp256r1) verification.
    #[instruction(discriminator = 1)]
    pub fn edit_domain_config<'info>(
        ctx: Context<'info, EditDomainConfig<'info>>,
        args: EditDomainConfigArgs,
    ) -> Result<()> {
        EditDomainConfig::process(ctx, args)
    }

    /// Enables or disables a domain configuration. Useful for temporary suspension.
    #[instruction(discriminator = 2)]
    pub fn disable_domain_config(ctx: Context<DisableDomainConfig>, disable: bool) -> Result<()> {
        DisableDomainConfig::process(ctx, disable)
    }

    /// Create a global counter to index all multi wallets
    #[instruction(discriminator = 3)]
    pub fn create_global_counter(ctx: Context<CreateGlobalCounter>) -> Result<()> {
        CreateGlobalCounter::process(ctx)
    }

    /// Create Domain User Account for WebAuthn
    #[instruction(discriminator = 4)]
    pub fn create_domain_user_account<'info>(
        ctx: Context<'info, CreateDomainUserAccount<'info>>,
        create_user_args: CreateDomainUserAccountArgs,
    ) -> Result<()> {
        CreateDomainUserAccount::process(ctx, create_user_args)
    }

    /// Create User Account (for linking a pubkey to a multisig wallet)
    #[instruction(discriminator = 5)]
    pub fn create_user_account<'info>(
        ctx: Context<'info, CreateUserAccount<'info>>,
        create_user_args: CreateUserAccountArgs,
    ) -> Result<()> {
        CreateUserAccount::process(ctx, create_user_args)
    }

    /// Edit Transaction Manager Url
    #[instruction(discriminator = 6)]
    pub fn edit_transaction_manager_url<'info>(
        ctx: Context<'info, EditTransactionManagerUrl<'info>>,
        transaction_manager_url: String,
    ) -> Result<()> {
        EditTransactionManagerUrl::process(ctx, transaction_manager_url)
    }

    /// Edit User Delegate
    #[instruction(discriminator = 7)]
    pub fn edit_user_delegate<'info>(
        ctx: Context<'info, EditUserDelegate<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        delegate_to: Option<u128>,
    ) -> Result<()> {
        EditUserDelegate::process(ctx, secp256r1_verify_args, delegate_to)
    }

    /// Applies one or more configuration changes to an existing multi-wallet.
    #[instruction(discriminator = 8)]
    pub fn change_config<'info>(
        ctx: Context<'info, ChangeConfig<'info>>,
        config_actions: Vec<ConfigAction>,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        ChangeConfig::process(ctx, config_actions, signers)
    }

    /// Creates a new transaction buffer to stage a transaction before execution.
    #[instruction(discriminator = 9)]
    pub fn transaction_buffer_create<'info>(
        ctx: Context<'info, TransactionBufferCreate<'info>>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferCreate::process(ctx, args, secp256r1_verify_args)
    }

    /// Signs a transaction buffer to register approval.
    #[instruction(discriminator = 10)]
    pub fn transaction_buffer_vote<'info>(
        ctx: Context<'info, TransactionBufferVote<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferVote::process(ctx, secp256r1_verify_args)
    }

    /// Extends an existing transaction buffer to allow for updated data or additional time.
    #[instruction(discriminator = 11)]
    pub fn transaction_buffer_extend<'info>(
        ctx: Context<'info, TransactionBufferExtend<'info>>,
        buffer: Vec<u8>,
    ) -> Result<()> {
        TransactionBufferExtend::process(ctx, buffer)
    }

    /// Closes and cleans up a transaction buffer.
    #[instruction(discriminator = 12)]
    pub fn transaction_buffer_close<'info>(
        ctx: Context<'info, TransactionBufferClose<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferClose::process(ctx, secp256r1_verify_args)
    }

    /// Executes a previously approved transaction buffer.
    #[instruction(discriminator = 13)]
    pub fn transaction_buffer_execute<'info>(
        ctx: Context<'info, TransactionBufferExecute<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferExecute::process(ctx, secp256r1_verify_args)
    }

    /// Executes a staged transaction from a buffer.
    #[instruction(discriminator = 14)]
    pub fn transaction_execute<'info>(
        ctx: Context<'info, TransactionExecute<'info>>,
    ) -> Result<()> {
        TransactionExecute::process(ctx)
    }

    /// Executes a transaction synchronously by directly submitting the message and verifying it.
    #[instruction(discriminator = 15)]
    pub fn transaction_execute_sync<'info>(
        ctx: Context<'info, TransactionExecuteSync<'info>>,
        transaction_message: TransactionMessage,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        TransactionExecuteSync::process(ctx, transaction_message, signers)
    }

    /// Creates a new multi-wallet with the specified permissions and ownership.
    #[instruction(discriminator = 16)]
    pub fn create_wallet<'info>(
        ctx: Context<'info, CreateWallet<'info>>,
        settings_index: u128,
    ) -> Result<()> {
        CreateWallet::process(ctx, settings_index)
    }

    /// Creates a native SOL transfer intent with on chain settings.
    /// Intents are one-step transfers that bypass the transaction buffer flow.
    #[instruction(discriminator = 17)]
    pub fn native_transfer_intent<'info>(
        ctx: Context<'info, NativeTransferIntent<'info>>,
        amount: u64,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        NativeTransferIntent::process(ctx, amount, signers)
    }

    /// Creates a token transfer intent with on chain settings.
    /// Intents are one-step transfers that bypass the transaction buffer flow.
    #[instruction(discriminator = 18)]
    pub fn token_transfer_intent<'info>(
        ctx: Context<'info, TokenTransferIntent<'info>>,
        amount: u64,
        signers: Vec<TransactionSyncSigners>,
    ) -> Result<()> {
        TokenTransferIntent::process(
            ctx, 
            amount,
            signers,
        )
    }
}

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
mod contexts;
mod error;
mod state;
mod utils;
use contexts::*;
use error::*;
use light_sdk::{cpi::CpiSigner, derive_light_cpi_signer};
use state::*;
use utils::*;

declare_id!("revibJxgb7X4j3tFT4n1oDNqZwLS28snWpPdwLRm7hb");

pub const ADMIN: Pubkey = pubkey!("G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF");

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("revibJxgb7X4j3tFT4n1oDNqZwLS28snWpPdwLRm7hb");

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

    /// Create a global counter to index all multi wallets
    pub fn create_global_counter(ctx: Context<CreateGlobalCounter>) -> Result<()> {
        CreateGlobalCounter::process(ctx)
    }

    /// Creates a new multi-wallet with the specified permissions and ownership.
    pub fn create_multi_wallet<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWallet<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        permissions: Permissions,
        delegate_creation_args: Option<DelegateCreationArgs>,
        compressed_proof_args: Option<ProofArgs>,
    ) -> Result<()> {
        CreateMultiWallet::process(
            ctx,
            secp256r1_verify_args,
            permissions,
            compressed_proof_args,
            delegate_creation_args,
        )
    }

    /// Applies one or more configuration changes to an existing multi-wallet.
    pub fn change_config<'info>(
        ctx: Context<'_, '_, 'info, 'info, ChangeConfig<'info>>,
        config_actions: Vec<ConfigAction>,
        compressed_proof_args: Option<ProofArgs>,
    ) -> Result<()> {
        ChangeConfig::process(ctx, config_actions, compressed_proof_args)
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
        buffer: Vec<u8>,
    ) -> Result<()> {
        TransactionBufferExtend::process(ctx, buffer)
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

    /**
     * Compressed Versions
     */

    /// Compress an existing settings account.
    pub fn compress_settings_account<'info>(
        ctx: Context<'_, '_, 'info, 'info, CompressSettingsAccount<'info>>,
        compressed_proof_args: ProofArgs,
        settings_creation_args: SettingsCreationArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        CompressSettingsAccount::process(
            ctx,
            compressed_proof_args,
            settings_creation_args,
            secp256r1_verify_args,
        )
    }

    /// Decompress an existing settings account.
    pub fn decompress_settings_account<'info>(
        ctx: Context<'_, '_, 'info, 'info, DecompressSettingsAccount<'info>>,
        settings_close_args: SettingsCloseArgs,
        compressed_proof_args: ProofArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        DecompressSettingsAccount::process(
            ctx,
            settings_close_args,
            compressed_proof_args,
            secp256r1_verify_args,
        )
    }

    /// Creates a new multi-wallet with the specified permissions and ownership.
    pub fn create_multi_wallet_compressed<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWalletCompressed<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        permissions: Permissions,
        compressed_proof_args: ProofArgs,
        settings_creation_args: SettingsCreationArgs,
        delegate_creation_args: Option<DelegateCreationArgs>,
    ) -> Result<()> {
        CreateMultiWalletCompressed::process(
            ctx,
            secp256r1_verify_args,
            permissions,
            compressed_proof_args,
            settings_creation_args,
            delegate_creation_args,
        )
    }

    /// Applies one or more configuration changes to an existing multi-wallet.
    pub fn change_config_compressed<'info>(
        ctx: Context<'_, '_, 'info, 'info, ChangeConfigCompressed<'info>>,
        config_actions: Vec<ConfigAction>,
        settings_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        ChangeConfigCompressed::process(ctx, config_actions, settings_args, compressed_proof_args)
    }

    /// Creates a new transaction buffer to stage a transaction before execution.
    pub fn transaction_buffer_create_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferCreateCompressed<'info>>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferCreateCompressed::process(
            ctx,
            args,
            secp256r1_verify_args,
            settings_args,
            compressed_proof_args,
        )
    }

    /// Signs a transaction buffer to register approval.
    pub fn transaction_buffer_vote_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferVoteCompressed<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferVoteCompressed::process(
            ctx,
            secp256r1_verify_args,
            settings_args,
            compressed_proof_args,
        )
    }

    /// Extends an existing transaction buffer to allow for updated data or additional time.
    pub fn transaction_buffer_extend_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExtendCompressed<'info>>,
        buffer: Vec<u8>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferExtendCompressed::process(
            ctx,
            buffer,
            settings_args,
            compressed_proof_args,
        )
    }

    /// Closes and cleans up a transaction buffer.
    pub fn transaction_buffer_close_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferCloseCompressed<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferCloseCompressed::process(
            ctx,
            secp256r1_verify_args,
            settings_args,
            compressed_proof_args,
        )
    }

    /// Executes a previously approved transaction buffer.
    pub fn transaction_buffer_execute_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExecuteCompressed<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferExecuteCompressed::process(
            ctx,
            secp256r1_verify_args,
            settings_args,
            compressed_proof_args,
        )
    }

    /// Executes a staged transaction from a buffer.
    pub fn transaction_execute_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionExecuteCompressed<'info>>,
        settings_key: Pubkey,
    ) -> Result<()> {
        TransactionExecuteCompressed::process(ctx, settings_key)
    }

    /// Executes a transaction synchronously by directly submitting the message and verifying it.
    pub fn transaction_execute_sync_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionExecuteSyncCompressed<'info>>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionExecuteSyncCompressed::process(
            ctx,
            transaction_message,
            secp256r1_verify_args,
            settings_args,
            compressed_proof_args,
        )
    }

    /// Transfers SPL tokens using a signed transfer intent.
    pub fn token_transfer_intent_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TokenTransferIntentCompressed<'info>>,
        amount: u64,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TokenTransferIntentCompressed::process(
            ctx,
            amount,
            secp256r1_verify_args,
            settings_args,
            compressed_proof_args,
        )
    }

    /// Transfers SOL using a signed transfer intent.
    pub fn native_transfer_intent_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, NativeTransferIntentCompressed<'info>>,
        amount: u64,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_args: SettingsProofArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        NativeTransferIntentCompressed::process(
            ctx,
            amount,
            secp256r1_verify_args,
            settings_args,
            compressed_proof_args,
        )
    }
}

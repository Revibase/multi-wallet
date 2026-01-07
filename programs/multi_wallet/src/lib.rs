#![allow(unexpected_cfgs)]
mod error;
mod instructions;
mod state;
mod utils;

use anchor_lang::prelude::*;
use error::*;
use instructions::*;
use light_sdk::{cpi::CpiSigner, derive_light_cpi_signer};
use state::*;
use utils::*;

declare_id!("reviR1xysEChySVSWGa43a6oJ2boJYTJhwRjo8KJhhT");

pub const ADMIN: Pubkey = pubkey!("AMn21jT5RMZrv5hSvtkrWCMJFp3cUyeAx4AxKvF59xJZ");

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("reviR1xysEChySVSWGa43a6oJ2boJYTJhwRjo8KJhhT");

#[program]
pub mod multi_wallet {

    use super::*;

    /// Initializes a new domain configuration used for WebAuthn (secp256r1) verification.
    #[instruction(discriminator = 0)]
    pub fn create_domain_config<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateDomainConfig<'info>>,
        args: CreateDomainConfigArgs,
    ) -> Result<()> {
        CreateDomainConfig::process(ctx, args)
    }

    /// Updates an existing domain configuration used for WebAuthn (secp256r1) verification.
    #[instruction(discriminator = 1)]
    pub fn edit_domain_config<'info>(
        ctx: Context<'_, '_, '_, 'info, EditDomainConfig<'info>>,
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
        ctx: Context<'_, '_, 'info, 'info, CreateDomainUserAccount<'info>>,
        compressed_proof_args: ProofArgs,
        create_user_args: CreateDomainUserAccountArgs,
    ) -> Result<()> {
        CreateDomainUserAccount::process(ctx, compressed_proof_args, create_user_args)
    }

    /// Create User Account (for linking a pubkey to a multisig wallet)
    #[instruction(discriminator = 5)]
    pub fn create_user_accounts<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateUserAccounts<'info>>,
        compressed_proof_args: ProofArgs,
        create_user_args: Vec<CreateUserAccountArgs>,
    ) -> Result<()> {
        CreateUserAccounts::process(ctx, compressed_proof_args, create_user_args)
    }

    /// Edit Transaction Manager Url
    #[instruction(discriminator = 6)]
    pub fn edit_transaction_manager_url<'info>(
        ctx: Context<'_, '_, 'info, 'info, EditTransactionManagerUrl<'info>>,
        user_mut_args: UserMutArgs,
        transaction_manager_url: String,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        EditTransactionManagerUrl::process(
            ctx,
            user_mut_args,
            transaction_manager_url,
            compressed_proof_args,
        )
    }

    /// Edit User Delegate
    #[instruction(discriminator = 7)]
    pub fn edit_user_delegate<'info>(
        ctx: Context<'_, '_, 'info, 'info, EditUserDelegate<'info>>,
        user_mut_args: UserMutArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        delegate_to: Option<SettingsIndexWithAddress>,
        old_settings_mut_args: Option<SettingsMutArgs>,
        new_settings_mut_args: Option<SettingsMutArgs>,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        EditUserDelegate::process(
            ctx,
            user_mut_args,
            secp256r1_verify_args,
            delegate_to,
            old_settings_mut_args,
            new_settings_mut_args,
            compressed_proof_args,
        )
    }

    /// add whitelisted address tree
    #[instruction(discriminator = 8)]
    pub fn add_whitelisted_address_trees<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddWhitelistedAddressTrees<'info>>,
        address_tree: Pubkey,
    ) -> Result<()> {
        AddWhitelistedAddressTrees::process(ctx, address_tree)
    }

    /// Applies one or more configuration changes to an existing multi-wallet.
    #[instruction(discriminator = 9)]
    pub fn change_config<'info>(
        ctx: Context<'_, '_, 'info, 'info, ChangeConfig<'info>>,
        settings_index: u128,
        config_actions: Vec<ConfigAction>,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        compressed_proof_args: Option<ProofArgs>,
    ) -> Result<()> {
        ChangeConfig::process(
            ctx,
            settings_index,
            config_actions,
            secp256r1_verify_args,
            compressed_proof_args,
        )
    }

    /// Creates a new transaction buffer to stage a transaction before execution.
    #[instruction(discriminator = 10)]
    pub fn transaction_buffer_create<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferCreate<'info>>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferCreate::process(ctx, args, secp256r1_verify_args)
    }

    /// Signs a transaction buffer to register approval.
    #[instruction(discriminator = 11)]
    pub fn transaction_buffer_vote<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferVote<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferVote::process(ctx, secp256r1_verify_args)
    }

    /// Extends an existing transaction buffer to allow for updated data or additional time.
    #[instruction(discriminator = 12)]
    pub fn transaction_buffer_extend<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExtend<'info>>,
        buffer: Vec<u8>,
    ) -> Result<()> {
        TransactionBufferExtend::process(ctx, buffer)
    }

    /// Closes and cleans up a transaction buffer.
    #[instruction(discriminator = 13)]
    pub fn transaction_buffer_close<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferClose<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferClose::process(ctx, secp256r1_verify_args)
    }

    /// Executes a previously approved transaction buffer.
    #[instruction(discriminator = 14)]
    pub fn transaction_buffer_execute<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExecute<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
    ) -> Result<()> {
        TransactionBufferExecute::process(ctx, secp256r1_verify_args)
    }

    /// Executes a staged transaction from a buffer.
    #[instruction(discriminator = 15)]
    pub fn transaction_execute<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionExecute<'info>>,
    ) -> Result<()> {
        TransactionExecute::process(ctx)
    }

    /// Executes a transaction synchronously by directly submitting the message and verifying it.
    #[instruction(discriminator = 16)]
    pub fn transaction_execute_sync<'info>(
        ctx: Context<'_, '_, 'info, 'info, TransactionExecuteSync<'info>>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        TransactionExecuteSync::process(ctx, transaction_message, secp256r1_verify_args)
    }

    /**
     * Compressed Versions
     */

    /// Compress an existing settings account.
    #[instruction(discriminator = 17)]
    pub fn compress_settings_account<'info>(
        ctx: Context<'_, '_, 'info, 'info, CompressSettingsAccount<'info>>,
        compressed_proof_args: ProofArgs,
        settings_mut_args: SettingsMutArgs,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        CompressSettingsAccount::process(
            ctx,
            compressed_proof_args,
            settings_mut_args,
            secp256r1_verify_args,
        )
    }

    /// Decompress an existing settings account.
    #[instruction(discriminator = 18)]
    pub fn decompress_settings_account<'info>(
        ctx: Context<'_, '_, 'info, 'info, DecompressSettingsAccount<'info>>,
        settings_mut: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        DecompressSettingsAccount::process(
            ctx,
            settings_mut,
            compressed_proof_args,
            secp256r1_verify_args,
        )
    }

    /// Creates a new multi-wallet with the specified permissions and ownership.
    #[instruction(discriminator = 19)]
    pub fn create_multi_wallet_compressed<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateMultiWalletCompressed<'info>>,
        compressed_proof_args: ProofArgs,
        settings_creation: SettingsCreationArgs,
        user_readonly_args: UserReadOnlyArgs,
        settings_index: u128,
    ) -> Result<()> {
        CreateMultiWalletCompressed::process(
            ctx,
            compressed_proof_args,
            settings_creation,
            user_readonly_args,
            settings_index,
        )
    }

    /// Applies one or more configuration changes to an existing multi-wallet.
    #[instruction(discriminator = 20)]
    pub fn change_config_compressed<'info>(
        ctx: Context<'_, '_, 'info, 'info, ChangeConfigCompressed<'info>>,
        config_actions: Vec<ConfigAction>,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_mut: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        ChangeConfigCompressed::process(
            ctx,
            config_actions,
            secp256r1_verify_args,
            settings_mut,
            compressed_proof_args,
        )
    }

    /// Creates a new transaction buffer to stage a transaction before execution.
    #[instruction(discriminator = 21)]
    pub fn transaction_buffer_create_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferCreateCompressed<'info>>,
        args: TransactionBufferCreateArgs,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_readonly_args: SettingsReadonlyArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferCreateCompressed::process(
            ctx,
            args,
            secp256r1_verify_args,
            settings_readonly_args,
            compressed_proof_args,
        )
    }

    /// Signs a transaction buffer to register approval.
    #[instruction(discriminator = 22)]
    pub fn transaction_buffer_vote_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferVoteCompressed<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_readonly_args: SettingsReadonlyArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferVoteCompressed::process(
            ctx,
            secp256r1_verify_args,
            settings_readonly_args,
            compressed_proof_args,
        )
    }

    /// Extends an existing transaction buffer to allow for updated data or additional time.
    #[instruction(discriminator = 23)]
    pub fn transaction_buffer_extend_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExtendCompressed<'info>>,
        buffer: Vec<u8>,
        settings_key: Pubkey,
    ) -> Result<()> {
        TransactionBufferExtendCompressed::process(ctx, buffer, settings_key)
    }

    /// Closes and cleans up a transaction buffer.
    #[instruction(discriminator = 24)]
    pub fn transaction_buffer_close_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferCloseCompressed<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferCloseCompressed::process(
            ctx,
            secp256r1_verify_args,
            settings_mut_args,
            compressed_proof_args,
        )
    }

    /// Executes a previously approved transaction buffer.
    #[instruction(discriminator = 25)]
    pub fn transaction_buffer_execute_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionBufferExecuteCompressed<'info>>,
        secp256r1_verify_args: Option<Secp256r1VerifyArgs>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionBufferExecuteCompressed::process(
            ctx,
            secp256r1_verify_args,
            settings_mut_args,
            compressed_proof_args,
        )
    }

    /// Executes a staged transaction from a buffer.
    #[instruction(discriminator = 26)]
    pub fn transaction_execute_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, TransactionExecuteCompressed<'info>>,
        settings_key: Pubkey,
    ) -> Result<()> {
        TransactionExecuteCompressed::process(ctx, settings_key)
    }

    /// Executes a transaction synchronously by directly submitting the message and verifying it.
    #[instruction(discriminator = 27)]
    pub fn transaction_execute_sync_compressed<'info>(
        ctx: Context<'_, '_, 'info, 'info, TransactionExecuteSyncCompressed<'info>>,
        transaction_message: TransactionMessage,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TransactionExecuteSyncCompressed::process(
            ctx,
            transaction_message,
            secp256r1_verify_args,
            settings_mut_args,
            compressed_proof_args,
        )
    }

    /// Creates a native SOL transfer intent with compressed settings verification.
    /// Intents are one-step transfers that bypass the transaction buffer flow.
    #[instruction(discriminator = 28)]
    pub fn native_transfer_intent_compressed<'info>(
        ctx: Context<'_, '_, 'info, 'info, NativeTransferIntentCompressed<'info>>,
        amount: u64,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        NativeTransferIntentCompressed::process(
            ctx,
            amount,
            secp256r1_verify_args,
            settings_mut_args,
            compressed_proof_args,
        )
    }

    /// Creates a token transfer intent with compressed settings verification.
    /// Intents are one-step transfers that bypass the transaction buffer flow.
    #[instruction(discriminator = 29)]
    pub fn token_transfer_intent_compressed<'info>(
        ctx: Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
        amount: u64,
        create_ata_if_needed: bool,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        TokenTransferIntentCompressed::process(
            ctx,
            amount,
            create_ata_if_needed,
            secp256r1_verify_args,
            settings_mut_args,
            compressed_proof_args,
        )
    }

    /// Creates a native SOL transfer intent with on chain settings.
    /// Intents are one-step transfers that bypass the transaction buffer flow.
    #[instruction(discriminator = 30)]
    pub fn native_transfer_intent<'info>(
        ctx: Context<'_, '_, 'info, 'info, NativeTransferIntent<'info>>,
        amount: u64,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        NativeTransferIntent::process(ctx, amount, secp256r1_verify_args)
    }

    /// Creates a token transfer intent with on chain settings.
    /// Intents are one-step transfers that bypass the transaction buffer flow.
    #[instruction(discriminator = 31)]
    pub fn token_transfer_intent<'info>(
        ctx: Context<'_, '_, 'info, 'info, TokenTransferIntent<'info>>,
        amount: u64,
        create_ata_if_needed: bool,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
    ) -> Result<()> {
        TokenTransferIntent::process(ctx, amount, create_ata_if_needed, secp256r1_verify_args)
    }

    #[instruction(discriminator = 32)]
    pub fn migrate_compressed_users<'info>(
        ctx: Context<'_, '_, 'info, 'info, MigrateCompressedUser<'info>>,
        args: User,
        compressed_proof_args: ProofArgs,
        user_creation_args: UserCreationArgs,
    ) -> Result<()> {
        MigrateCompressedUser::process(ctx, args, compressed_proof_args, user_creation_args)
    }

    #[instruction(discriminator = 33)]
    pub fn migrate_compressed_settings<'info>(
        ctx: Context<'_, '_, 'info, 'info, MigrateCompressedSettings<'info>>,
        args: CompressedSettingsData,
        compressed_proof_args: ProofArgs,
        settings_creation_args: SettingsCreationArgs,
    ) -> Result<()> {
        MigrateCompressedSettings::process(ctx, args, compressed_proof_args, settings_creation_args)
    }
}

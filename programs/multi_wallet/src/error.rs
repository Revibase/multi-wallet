use anchor_lang::prelude::*;

#[error_code]
pub enum MultisigError {
    #[msg("Signed message does not match expected message.")]
    InvalidSignedMessage,

    #[msg("Missing or malformed WebAuthn signature verification arguments (secp256r1).")]
    InvalidSecp256r1VerifyArg,

    #[msg("Durable nonce detected in the transaction. Durable nonces are unsupported.")]
    DurableNonceDetected,

    #[msg("Duplicate public keys found in the 'members' vector. Keys must be unique.")]
    DuplicateMember,

    #[msg("Cannot modify the initial member of the multisig.")]
    InitialMemberCannotBeModified,

    #[msg("Multisig must have at least one member.")]
    EmptyMembers,

    #[msg("Member list exceeds maximum allowed length (65,535).")]
    TooManyMembers,

    #[msg("Invalid threshold. Must be ≥ 1 and ≤ voting members (only one passkey voter counts).")]
    InvalidThreshold,

    #[msg("Malformed or invalid TransactionMessage structure.")]
    InvalidTransactionMessage,

    #[msg("Mismatch in expected and provided account count.")]
    InvalidNumberOfAccounts,

    #[msg("One or more provided accounts failed validation.")]
    InvalidAccount,

    #[msg("Required account is missing from instruction context.")]
    MissingAccount,

    #[msg("Target account already exists. Initialization is not allowed.")]
    AccountAlreadyExist,

    #[msg("Account is not owned by the multisig program.")]
    IllegalAccountOwner,

    #[msg("At least one signer must have 'execute' permission.")]
    InsufficientSignerWithExecutePermission,

    #[msg("At least one signer must have 'initiate' permission.")]
    InsufficientSignerWithInitiatePermission,

    #[msg("Threshold exceeds number of members with 'vote' permission.")]
    InsufficientSignersWithVotePermission,

    #[msg("At least one signer must have 'is_delegate' permission.")]
    InsufficientSignerWithIsDelegatePermission,

    #[msg("No valid signer was found in the current context.")]
    NoSignerFound,

    #[msg("Only the transaction creator or rent payer may close the transaction buffer.")]
    UnauthorisedToCloseTransactionBuffer,

    #[msg("Buffer content does not match the expected hash.")]
    InvalidBuffer,

    #[msg("Final buffer hash mismatch. Possibly tampered or improperly serialized.")]
    FinalBufferHashMismatch,

    #[msg("Final serialized buffer size exceeds the 10128-byte limit.")]
    FinalBufferSizeExceeded,

    #[msg("Declared final buffer size does not match actual size.")]
    FinalBufferSizeMismatch,

    #[msg("Transaction expired — TTL of 3 minutes exceeded.")]
    TransactionHasExpired,

    #[msg("Transaction has not yet reached the required approval threshold.")]
    TransactionNotApproved,

    #[msg("Writable CPI attempted on a protected account. This is not allowed.")]
    ProtectedAccount,

    #[msg("Input string exceeded the character limit.")]
    MaxLengthExceeded,

    #[msg("Sysvar: Slot history is missing. Ensure it's passed as an account.")]
    MissingSysvarSlotHistory,

    #[msg("Sysvar parsing failed. Expected slot history format is invalid or corrupted.")]
    InvalidSysvarDataFormat,

    #[msg("Specified slot not found in the provided slot history.")]
    SlotNumberNotFound,

    #[msg("Slot hash does not match recorded history.")]
    SlotHashMismatch,

    #[msg("The specified domain configuration account is temporarily disabled.")]
    DomainConfigIsDisabled,

    #[msg("Domain configuration account is missing.")]
    DomainConfigIsMissing,

    #[msg("Member is not registered in the specified domain config.")]
    MemberDoesNotBelongToDomainConfig,

    #[msg("Client RP ID hash does not match domain configuration.")]
    RpIdHashMismatch,

    #[msg("Failed to parse JSON in client data. Invalid format.")]
    InvalidJson,

    #[msg("Missing 'origin' field in clientDataJSON.")]
    MissingOrigin,

    #[msg("Invalid or unexpected 'origin' in clientDataJSON.")]
    InvalidOrigin,

    #[msg("Missing 'type' field in clientDataJSON.")]
    MissingType,

    #[msg("Invalid 'type' in clientDataJSON. Expected 'webauthn.get'.")]
    InvalidType,

    #[msg("Missing 'challenge' field in clientDataJSON.")]
    MissingChallenge,

    #[msg("Invalid or mismatched challenge in clientDataJSON.")]
    InvalidChallenge,
}

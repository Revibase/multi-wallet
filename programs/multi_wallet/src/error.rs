use anchor_lang::prelude::*;

#[error_code]
pub enum MultisigError {
    #[msg("Missing webauthn signature verify arguments.")]
    InvalidSecp256r1VerifyArg,

    #[msg("Durable nonce detected. Durable nonce is not allowed for this transaction.")]
    DurableNonceDetected,

    #[msg("Duplicate public keys found in the members array. Each member must have a unique public key.")]
    DuplicateMember,

    #[msg("The members array cannot be empty. Add at least one member.")]
    EmptyMembers,

    #[msg("Too many members specified. A maximum of 65,535 members is allowed.")]
    TooManyMembers,

    #[msg("Threshold must be between 1 and the total number of voting members. Note: only one passkey voter is counted toward this limit, even if more are registered.")]
    InvalidThreshold,

    #[msg("The provided TransactionMessage is malformed or improperly formatted.")]
    InvalidTransactionMessage,

    #[msg("Incorrect number of accounts provided. Verify the account count matches the expected number.")]
    InvalidNumberOfAccounts,

    #[msg("One or more accounts provided are invalid. Ensure all accounts meet the requirements.")]
    InvalidAccount,

    #[msg("Required account is missing. Ensure all necessary accounts are included.")]
    MissingAccount,

    #[msg("The account already exist.")]
    AccountAlreadyExist,

    #[msg("Account is not owned by the Multisig program. Only accounts under the Multisig program can be used.")]
    IllegalAccountOwner,

    #[msg("Require at least one signer to have the execute permission.")]
    InsufficientSignerWithExecutePermission,

    #[msg("Require at least one signer to have the initiate permission.")]
    InsufficientSignerWithInitiatePermission,

    #[msg("Require threshold to be lesser than or equal to the number of members with vote permission.")]
    InsufficientSignersWithVotePermission,

    #[msg("Require at least one signer to have isDelegate permission.")]
    InsufficientSignerWithIsDelegatePermission,

    #[msg("No signer found.")]
    NoSignerFound,

    #[msg("Only the creator or rent payer of the transaction buffer have permission to close the buffer.")]
    UnauthorisedToCloseTransactionBuffer,

    #[msg("Buffer does not match the pre defined buffer.")]
    InvalidBuffer,

    #[msg("Final message buffer hash doesnt match the expected hash")]
    FinalBufferHashMismatch,

    #[msg("Final buffer size cannot exceed 4000 bytes")]
    FinalBufferSizeExceeded,

    #[msg("Final buffer size mismatch")]
    FinalBufferSizeMismatch,

    #[msg("Transaction has expired. 3 min has passed since the transaction was created.")]
    TransactionHasExpired,

    #[msg("Transaction isn't approved for execution yet.")]
    TransactionNotApproved,

    #[msg("Account is protected, it cannot be passed into a CPI as writable")]
    ProtectedAccount,

    #[msg("String must be lesser than 256 characters.")]
    MaxLengthExceeded,

    #[msg("Slot history sysvar is missing.")]
    MissingSysvarSlotHistory,

    #[msg("Failed to parse sysvar data.")]
    InvalidSysvarDataFormat,

    #[msg("Slot number not found in slot history.")]
    SlotNumberNotFound,

    #[msg("Slot hash does not match the expected value.")]
    SlotHashMismatch,

    #[msg("Domain Config is missing.")]
    DomainConfigIsMissing,

    #[msg("Member does not belong to the specified domain config.")]
    MemberDoesNotBelongToDomainConfig,

    #[msg("Rp Id does not match with the specified domain config.")]
    RpIdHashMismatch,

    #[msg("Metadata containing the pubkey of the domain config account is required when adding a passkey")]
    MissingMetadata,

    #[msg("Unable to parse json data.")]
    InvalidJson,

    #[msg("Origin is missing in client data json")]
    MissingOrigin,

    #[msg("Origin in client data json is invalid.")]
    InvalidOrigin,

    #[msg("Type is missing in client data json")]
    MissingType,

    #[msg("Type in client data json is not equals to webauthn.get")]
    InvalidType,

    #[msg("Challenge is missing in client data json")]
    MissingChallenge,

    #[msg("Challenge in client data json is invalid.")]
    InvalidChallenge,
}

use anchor_lang::prelude::*;

#[error_code]
pub enum MultisigError {
    #[msg("The provided signature doesn't match the expected message. Make sure you're signing the correct payload.")]
    InvalidSignedMessage,

    #[msg("Missing or incorrectly formatted WebAuthn verification arguments. Please check the secp256r1 signature input.")]
    InvalidSecp256r1VerifyArg,

    #[msg("This transaction includes a durable nonce, which is not supported by this program.")]
    DurableNonceDetected,

    #[msg(
        "Duplicate public keys detected in the member list. Each member must have a unique key."
    )]
    DuplicateMember,

    #[msg("Permanent members cannot be removed from the wallet.")]
    PermanentMember,

    #[msg("Permanent members can only be added during wallet creation.")]
    PermanentMemberPermissionNotAllowed,

    #[msg(
        "A permanent member must be have delegate permissions and have no settings index assigned."
    )]
    InvalidPermanentMember,

    #[msg("Only a maximum of one permanent member is allowed per wallet.")]
    TooManyPermanentMember,

    #[msg("No members were provided. A multisig must have at least one member.")]
    EmptyMembers,

    #[msg("The number of members exceeds the supported maximum 4.")]
    TooManyMembers,

    #[msg("Invalid threshold value. It must be at least 1 and not exceed the number of voting-eligible members.")]
    InvalidThreshold,

    #[msg(
        "The transaction message structure is malformed or does not follow expected formatting."
    )]
    InvalidTransactionMessage,

    #[msg(
        "The number of provided accounts does not match what was expected for this instruction."
    )]
    InvalidNumberOfAccounts,

    #[msg("One or more accounts provided failed validation. Ensure all required accounts are included and correct.")]
    InvalidAccount,

    #[msg("One or more arguments provided failed validation. Ensure all required arguments are included and correct.")]
    InvalidArguments,

    #[msg("A required account is missing from the transaction context.")]
    MissingAccount,

    #[msg("A user delegate mutation args is required when the initial member has requested delegate permissions.")]
    MissingUserDelegateArgs,

    #[msg("A user is currently delegated to another wallet.")]
    UserAlreadyDelegated,

    #[msg("A user is currently not delegated.")]
    UserNotDelegated,

    #[msg("At least one signer must have execute permissions to proceed.")]
    InsufficientSignerWithExecutePermission,

    #[msg("At least one signer must have initiate permissions to perform this action.")]
    InsufficientSignerWithInitiatePermission,

    #[msg("The approval threshold cannot be met because there aren't enough voters with the vote permission.")]
    InsufficientSignersWithVotePermission,

    #[msg("No valid signer was found in this transaction. Ensure at least one authorized signer is present.")]
    NoSignerFound,

    #[msg(
        "Only the transaction's creator or rent payer is allowed to close the transaction buffer."
    )]
    UnauthorisedToCloseTransactionBuffer,

    #[msg("The contents of the buffer do not match the expected hash. It may have been tampered with.")]
    InvalidBuffer,

    #[msg("The final hash of the buffer doesn't match what was expected. The buffer might be corrupted or altered.")]
    FinalBufferHashMismatch,

    #[msg("The serialized transaction buffer exceeds the maximum allowed size of 10,128 bytes.")]
    FinalBufferSizeExceeded,

    #[msg("The declared size of the buffer does not match its actual size.")]
    FinalBufferSizeMismatch,

    #[msg("The transaction has expired. It must be executed within 3 minutes of approval.")]
    TransactionHasExpired,

    #[msg("The transaction hasn't received enough approvals yet to be executed.")]
    TransactionNotApproved,

    #[msg("Writable CPI calls to protected accounts are not permitted.")]
    ProtectedAccount,

    #[msg("One of the input strings exceeds the maximum allowed character limit.")]
    MaxLengthExceeded,

    #[msg("The Slot History sysvar account is missing. It must be included as an account in this instruction.")]
    MissingSysvarSlotHistory,

    #[msg("Failed to parse sysvar: slot history format is invalid or corrupted.")]
    InvalidSysvarDataFormat,

    #[msg("The specified slot number is not present in the provided slot history.")]
    SlotNumberNotFound,

    #[msg("The domain configuration account is currently disabled. Contact support or try again later.")]
    DomainConfigIsDisabled,

    #[msg("Missing domain configuration account. Ensure it's passed in the instruction.")]
    DomainConfigIsMissing,

    #[msg("This member is not registered in the provided domain configuration.")]
    MemberDoesNotBelongToDomainConfig,

    #[msg(
        "The relying party ID hash does not match the one specified in the domain configuration."
    )]
    RpIdHashMismatch,

    #[msg("Failed to parse the client data JSON. The format may be invalid.")]
    InvalidJson,

    #[msg(
        "Missing origin field in clientDataJSON. This field is required for WebAuthn validation."
    )]
    MissingOrigin,

    #[msg("The origin value in clientDataJSON does not match the expected domain.")]
    InvalidOrigin,

    #[msg("Missing type field in clientDataJSON. This field is required for WebAuthn validation.")]
    MissingType,

    #[msg("The type field in clientDataJSON is invalid. Expected value: webauthn.get.")]
    InvalidType,

    #[msg("Missing challenge field in clientDataJSON. This is required for validating the authentication request.")]
    MissingChallenge,

    #[msg(
        "The challenge value in clientDataJSON is missing or doesn't match the expected challenge."
    )]
    InvalidChallenge,
}

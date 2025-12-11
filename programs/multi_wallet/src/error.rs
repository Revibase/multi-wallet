use anchor_lang::prelude::*;

#[error_code]
pub enum MultisigError {
    #[msg("Malformed or missing WebAuthn verification parameters. Please provide valid secp256r1 signature arguments.")]
    InvalidSecp256r1VerifyArg,

    #[msg("The instruction preceding this program invocation is not a secp256r1 verification instruction.")]
    InvalidSecp256r1Instruction,

    #[msg("The signature index provided is out of bounds for the secp256r1 instruction.")]
    SignatureIndexOutOfBounds,

    #[msg("Failed to deserialize secp256r1 signature offsets from the instruction data.")]
    InvalidSignatureOffsets,

    #[msg("The extracted public key has an invalid length or encoding.")]
    InvalidSecp256r1PublicKey,

    #[msg("The extracted WebAuthn signed message payload is malformed.")]
    MalformedSignedMessage,

    #[msg("The rpIdHash extracted from the signed message does not match the expected value.")]
    RpIdHashMismatch,

    #[msg(
        "The clientDataJSON hash extracted from the signature does not match the generated hash."
    )]
    ClientDataHashMismatch,

    #[msg("The message hash associated with the signer does not match the pre-declared expected message hash.")]
    ExpectedMessageHashMismatch,

    #[msg(
        "Durable nonce detected: this program does not support transactions using a durable nonce."
    )]
    DurableNonceDetected,

    #[msg("Duplicate public keys detected among members. Each member must have a unique key.")]
    DuplicateMember,

    #[msg("Permanent members cannot be removed from a wallet.")]
    PermanentMember,

    #[msg("Only one permanent member is allowed per wallet.")]
    OnlyOnePermanentMemberAllowed,

    #[msg("User with Permanent Member role requires a must have a delegated wallet.")]
    InvalidPermanentMemberConfig,

    #[msg("Only one transaction manager is allowed per wallet.")]
    OnlyOneTransactionManagerAllowed,

    #[msg("Invalid Transaction Manager permissions. Only initiate is allowed.")]
    InvalidTransactionManagerPermission,

    #[msg("Expected a User with Transaction Manager role for this instruction.")]
    ExpectedTransactionManagerRoleMismatch,

    #[msg("User with Transaction Manager role requires a valid transaction manager url, be a ed25519 Signer and have no delegated wallet.")]
    InvalidTransactionManagerConfig,

    #[msg("Expected a User with Administrator role for this instruction.")]
    ExpectedAdministratorRoleMismatch,

    #[msg("User with Administrator role requires a valid domain config, be a ed25519 Signer and have no delegated wallet.")]
    InvalidAdministratorConfig,

    #[msg("No members provided. A multisig wallet must contain at least one member.")]
    EmptyMembers,

    #[msg("Too many members: a maximum of 4 members are supported.")]
    TooManyMembers,

    #[msg("Invalid threshold: must be at least 1 and cannot exceed the number of voting-eligible members.")]
    InvalidThreshold,

    #[msg("Malformed transaction message: structure or formatting does not match the expected layout.")]
    InvalidTransactionMessage,

    #[msg("Unexpected number of accounts provided for this instruction.")]
    InvalidNumberOfAccounts,

    #[msg("One or more provided accounts failed validation. Verify that all required accounts are included and correct.")]
    InvalidAccount,

    #[msg("One or more provided user accounts failed validation. Verify that only users with appropriate roles are allowed to perform this action.")]
    InvalidUserRole,

    #[msg("Invalid or missing instruction arguments. Ensure all required arguments are correctly provided.")]
    InvalidArguments,

    #[msg("A required account is missing from the instruction context.")]
    MissingAccount,

    #[msg(
        "User mutation arguments are required when performing add or remove delegate operations."
    )]
    MissingUserArgs,

    #[msg("This member is already delegated to another wallet.")]
    AlreadyDelegated,

    #[msg("At least one signer with execute permission is required to proceed.")]
    InsufficientSignerWithExecutePermission,

    #[msg("At least one signer with initiate permission is required to perform this action.")]
    InsufficientSignerWithInitiatePermission,

    #[msg("Not enough members with vote permission to meet the approval threshold.")]
    InsufficientSignersWithVotePermission,

    #[msg("Only delegated members are allowed for this transaction.")]
    InvalidNonDelegatedSigners,

    #[msg("Member is not part of the expected signers for this transaction.")]
    UnexpectedSigner,

    #[msg("No valid signer found in this transaction.")]
    NoSignerFound,

    #[msg("Only the transaction creator or rent payer may close this transaction buffer.")]
    UnauthorisedToCloseTransactionBuffer,

    #[msg("Buffer validation failed: contents do not match the expected hash (possible tampering detected).")]
    InvalidBuffer,

    #[msg("Final buffer hash mismatch: the serialized data may be corrupted or altered.")]
    FinalBufferHashMismatch,

    #[msg("The serialized transaction buffer exceeds the maximum size of 10,128 bytes.")]
    FinalBufferSizeExceeded,

    #[msg("Declared buffer size does not match the actual serialized size.")]
    FinalBufferSizeMismatch,

    #[msg("This transaction has expired. It must be executed within 3 minutes of approval.")]
    TransactionHasExpired,

    #[msg("This transaction has not yet reached the required approval threshold.")]
    TransactionNotApproved,

    #[msg("Writable CPI calls to protected accounts are not permitted.")]
    ProtectedAccount,

    #[msg("An input string exceeds the maximum allowed character length.")]
    MaxLengthExceeded,

    #[msg(
        "Missing required sysvar: Slot History must be included as an account in this instruction."
    )]
    MissingSysvarSlotHistory,

    #[msg("Failed to parse the Slot History sysvar: data format is invalid or corrupted.")]
    InvalidSysvarDataFormat,

    #[msg("The specified slot number was not found in the provided slot history.")]
    SlotNumberNotFound,

    #[msg(
        "The domain configuration account is disabled. Please contact support or try again later."
    )]
    DomainConfigIsDisabled,

    #[msg("Missing domain configuration account.")]
    DomainConfigIsMissing,

    #[msg("This member is not registered under the provided domain configuration.")]
    MemberDoesNotBelongToDomainConfig,

    #[msg("The given origin index is not in the whitelisted origins.")]
    OriginIndexOutOfBounds,

    #[msg("Address Tree supplied is not part of the whitelisted address trees")]
    InvalidAddressTree,
}

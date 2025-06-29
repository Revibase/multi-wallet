/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  isProgramError,
  type Address,
  type SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  type SolanaError,
} from "@solana/kit";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../programs";

/** InvalidSignedMessage: The provided signature doesn't match the expected message. Make sure you're signing the correct payload. */
export const MULTI_WALLET_ERROR__INVALID_SIGNED_MESSAGE = 0x1770; // 6000
/** InvalidSecp256r1VerifyArg: Missing or incorrectly formatted WebAuthn verification arguments. Please check the secp256r1 signature input. */
export const MULTI_WALLET_ERROR__INVALID_SECP256R1_VERIFY_ARG = 0x1771; // 6001
/** DurableNonceDetected: This transaction includes a durable nonce, which is not supported by this program. */
export const MULTI_WALLET_ERROR__DURABLE_NONCE_DETECTED = 0x1772; // 6002
/** DuplicateMember: Duplicate public keys detected in the member list. Each member must have a unique key. */
export const MULTI_WALLET_ERROR__DUPLICATE_MEMBER = 0x1773; // 6003
/** EmptyMembers: No members were provided. A multisig must have at least one member. */
export const MULTI_WALLET_ERROR__EMPTY_MEMBERS = 0x1774; // 6004
/** TooManyMembers: The number of members exceeds the supported maximum (65,535). */
export const MULTI_WALLET_ERROR__TOO_MANY_MEMBERS = 0x1775; // 6005
/** InvalidThreshold: Invalid threshold value. It must be at least 1 and not exceed the number of voting-eligible members. */
export const MULTI_WALLET_ERROR__INVALID_THRESHOLD = 0x1776; // 6006
/** InvalidTransactionMessage: The transaction message structure is malformed or does not follow expected formatting. */
export const MULTI_WALLET_ERROR__INVALID_TRANSACTION_MESSAGE = 0x1777; // 6007
/** InvalidNumberOfAccounts: The number of provided accounts does not match what was expected for this instruction. */
export const MULTI_WALLET_ERROR__INVALID_NUMBER_OF_ACCOUNTS = 0x1778; // 6008
/** InvalidAccount: One or more accounts provided failed validation. Ensure all required accounts are included and correct. */
export const MULTI_WALLET_ERROR__INVALID_ACCOUNT = 0x1779; // 6009
/** MissingAccount: A required account is missing from the transaction context. */
export const MULTI_WALLET_ERROR__MISSING_ACCOUNT = 0x177a; // 6010
/** AccountAlreadyExist: The account you're trying to initialize already exists. */
export const MULTI_WALLET_ERROR__ACCOUNT_ALREADY_EXIST = 0x177b; // 6011
/** IllegalAccountOwner: The account is not owned by the multisig program. Ensure the correct program owns this account. */
export const MULTI_WALLET_ERROR__ILLEGAL_ACCOUNT_OWNER = 0x177c; // 6012
/** InsuffientSignerWithDelegatePermission: A delegate account is required when the initial member has requested delegate permissions. */
export const MULTI_WALLET_ERROR__INSUFFIENT_SIGNER_WITH_DELEGATE_PERMISSION = 0x177d; // 6013
/** InsufficientSignerWithExecutePermission: At least one signer must have execute permissions to proceed. */
export const MULTI_WALLET_ERROR__INSUFFICIENT_SIGNER_WITH_EXECUTE_PERMISSION = 0x177e; // 6014
/** InsufficientSignerWithInitiatePermission: At least one signer must have initiate permissions to perform this action. */
export const MULTI_WALLET_ERROR__INSUFFICIENT_SIGNER_WITH_INITIATE_PERMISSION = 0x177f; // 6015
/** InsufficientSignersWithVotePermission: The approval threshold cannot be met because there aren't enough voters with the vote permission. */
export const MULTI_WALLET_ERROR__INSUFFICIENT_SIGNERS_WITH_VOTE_PERMISSION = 0x1780; // 6016
/** NoSignerFound: No valid signer was found in this transaction. Ensure at least one authorized signer is present. */
export const MULTI_WALLET_ERROR__NO_SIGNER_FOUND = 0x1781; // 6017
/** UnauthorisedToCloseTransactionBuffer: Only the transaction's creator or rent payer is allowed to close the transaction buffer. */
export const MULTI_WALLET_ERROR__UNAUTHORISED_TO_CLOSE_TRANSACTION_BUFFER = 0x1782; // 6018
/** InvalidBuffer: The contents of the buffer do not match the expected hash. It may have been tampered with. */
export const MULTI_WALLET_ERROR__INVALID_BUFFER = 0x1783; // 6019
/** FinalBufferHashMismatch: The final hash of the buffer doesn't match what was expected. The buffer might be corrupted or altered. */
export const MULTI_WALLET_ERROR__FINAL_BUFFER_HASH_MISMATCH = 0x1784; // 6020
/** FinalBufferSizeExceeded: The serialized transaction buffer exceeds the maximum allowed size of 10,128 bytes. */
export const MULTI_WALLET_ERROR__FINAL_BUFFER_SIZE_EXCEEDED = 0x1785; // 6021
/** FinalBufferSizeMismatch: The declared size of the buffer does not match its actual size. */
export const MULTI_WALLET_ERROR__FINAL_BUFFER_SIZE_MISMATCH = 0x1786; // 6022
/** TransactionHasExpired: The transaction has expired. It must be executed within 3 minutes of approval. */
export const MULTI_WALLET_ERROR__TRANSACTION_HAS_EXPIRED = 0x1787; // 6023
/** TransactionNotApproved: The transaction hasn't received enough approvals yet to be executed. */
export const MULTI_WALLET_ERROR__TRANSACTION_NOT_APPROVED = 0x1788; // 6024
/** ProtectedAccount: Writable CPI calls to protected accounts are not permitted. */
export const MULTI_WALLET_ERROR__PROTECTED_ACCOUNT = 0x1789; // 6025
/** MaxLengthExceeded: One of the input strings exceeds the maximum allowed character limit. */
export const MULTI_WALLET_ERROR__MAX_LENGTH_EXCEEDED = 0x178a; // 6026
/** MissingSysvarSlotHistory: The Slot History sysvar account is missing. It must be included as an account in this instruction. */
export const MULTI_WALLET_ERROR__MISSING_SYSVAR_SLOT_HISTORY = 0x178b; // 6027
/** InvalidSysvarDataFormat: Failed to parse sysvar: slot history format is invalid or corrupted. */
export const MULTI_WALLET_ERROR__INVALID_SYSVAR_DATA_FORMAT = 0x178c; // 6028
/** SlotNumberNotFound: The specified slot number is not present in the provided slot history. */
export const MULTI_WALLET_ERROR__SLOT_NUMBER_NOT_FOUND = 0x178d; // 6029
/** SlotHashMismatch: The slot hash doesn't match the expected value from slot history. */
export const MULTI_WALLET_ERROR__SLOT_HASH_MISMATCH = 0x178e; // 6030
/** DomainConfigIsDisabled: The domain configuration account is currently disabled. Contact support or try again later. */
export const MULTI_WALLET_ERROR__DOMAIN_CONFIG_IS_DISABLED = 0x178f; // 6031
/** DomainConfigIsMissing: Missing domain configuration account. Ensure it's passed in the instruction. */
export const MULTI_WALLET_ERROR__DOMAIN_CONFIG_IS_MISSING = 0x1790; // 6032
/** MemberDoesNotBelongToDomainConfig: This member is not registered in the provided domain configuration. */
export const MULTI_WALLET_ERROR__MEMBER_DOES_NOT_BELONG_TO_DOMAIN_CONFIG = 0x1791; // 6033
/** RpIdHashMismatch: The relying party ID hash does not match the one specified in the domain configuration. */
export const MULTI_WALLET_ERROR__RP_ID_HASH_MISMATCH = 0x1792; // 6034
/** InvalidJson: Failed to parse the client data JSON. The format may be invalid. */
export const MULTI_WALLET_ERROR__INVALID_JSON = 0x1793; // 6035
/** MissingOrigin: Missing origin field in clientDataJSON. This field is required for WebAuthn validation. */
export const MULTI_WALLET_ERROR__MISSING_ORIGIN = 0x1794; // 6036
/** InvalidOrigin: The origin value in clientDataJSON does not match the expected domain. */
export const MULTI_WALLET_ERROR__INVALID_ORIGIN = 0x1795; // 6037
/** MissingType: Missing type field in clientDataJSON. This field is required for WebAuthn validation. */
export const MULTI_WALLET_ERROR__MISSING_TYPE = 0x1796; // 6038
/** InvalidType: The type field in clientDataJSON is invalid. Expected value: webauthn.get. */
export const MULTI_WALLET_ERROR__INVALID_TYPE = 0x1797; // 6039
/** MissingChallenge: Missing challenge field in clientDataJSON. This is required for validating the authentication request. */
export const MULTI_WALLET_ERROR__MISSING_CHALLENGE = 0x1798; // 6040
/** InvalidChallenge: The challenge value in clientDataJSON is missing or doesn't match the expected challenge. */
export const MULTI_WALLET_ERROR__INVALID_CHALLENGE = 0x1799; // 6041

export type MultiWalletError =
  | typeof MULTI_WALLET_ERROR__ACCOUNT_ALREADY_EXIST
  | typeof MULTI_WALLET_ERROR__DOMAIN_CONFIG_IS_DISABLED
  | typeof MULTI_WALLET_ERROR__DOMAIN_CONFIG_IS_MISSING
  | typeof MULTI_WALLET_ERROR__DUPLICATE_MEMBER
  | typeof MULTI_WALLET_ERROR__DURABLE_NONCE_DETECTED
  | typeof MULTI_WALLET_ERROR__EMPTY_MEMBERS
  | typeof MULTI_WALLET_ERROR__FINAL_BUFFER_HASH_MISMATCH
  | typeof MULTI_WALLET_ERROR__FINAL_BUFFER_SIZE_EXCEEDED
  | typeof MULTI_WALLET_ERROR__FINAL_BUFFER_SIZE_MISMATCH
  | typeof MULTI_WALLET_ERROR__ILLEGAL_ACCOUNT_OWNER
  | typeof MULTI_WALLET_ERROR__INSUFFICIENT_SIGNERS_WITH_VOTE_PERMISSION
  | typeof MULTI_WALLET_ERROR__INSUFFICIENT_SIGNER_WITH_EXECUTE_PERMISSION
  | typeof MULTI_WALLET_ERROR__INSUFFICIENT_SIGNER_WITH_INITIATE_PERMISSION
  | typeof MULTI_WALLET_ERROR__INSUFFIENT_SIGNER_WITH_DELEGATE_PERMISSION
  | typeof MULTI_WALLET_ERROR__INVALID_ACCOUNT
  | typeof MULTI_WALLET_ERROR__INVALID_BUFFER
  | typeof MULTI_WALLET_ERROR__INVALID_CHALLENGE
  | typeof MULTI_WALLET_ERROR__INVALID_JSON
  | typeof MULTI_WALLET_ERROR__INVALID_NUMBER_OF_ACCOUNTS
  | typeof MULTI_WALLET_ERROR__INVALID_ORIGIN
  | typeof MULTI_WALLET_ERROR__INVALID_SECP256R1_VERIFY_ARG
  | typeof MULTI_WALLET_ERROR__INVALID_SIGNED_MESSAGE
  | typeof MULTI_WALLET_ERROR__INVALID_SYSVAR_DATA_FORMAT
  | typeof MULTI_WALLET_ERROR__INVALID_THRESHOLD
  | typeof MULTI_WALLET_ERROR__INVALID_TRANSACTION_MESSAGE
  | typeof MULTI_WALLET_ERROR__INVALID_TYPE
  | typeof MULTI_WALLET_ERROR__MAX_LENGTH_EXCEEDED
  | typeof MULTI_WALLET_ERROR__MEMBER_DOES_NOT_BELONG_TO_DOMAIN_CONFIG
  | typeof MULTI_WALLET_ERROR__MISSING_ACCOUNT
  | typeof MULTI_WALLET_ERROR__MISSING_CHALLENGE
  | typeof MULTI_WALLET_ERROR__MISSING_ORIGIN
  | typeof MULTI_WALLET_ERROR__MISSING_SYSVAR_SLOT_HISTORY
  | typeof MULTI_WALLET_ERROR__MISSING_TYPE
  | typeof MULTI_WALLET_ERROR__NO_SIGNER_FOUND
  | typeof MULTI_WALLET_ERROR__PROTECTED_ACCOUNT
  | typeof MULTI_WALLET_ERROR__RP_ID_HASH_MISMATCH
  | typeof MULTI_WALLET_ERROR__SLOT_HASH_MISMATCH
  | typeof MULTI_WALLET_ERROR__SLOT_NUMBER_NOT_FOUND
  | typeof MULTI_WALLET_ERROR__TOO_MANY_MEMBERS
  | typeof MULTI_WALLET_ERROR__TRANSACTION_HAS_EXPIRED
  | typeof MULTI_WALLET_ERROR__TRANSACTION_NOT_APPROVED
  | typeof MULTI_WALLET_ERROR__UNAUTHORISED_TO_CLOSE_TRANSACTION_BUFFER;

let multiWalletErrorMessages: Record<MultiWalletError, string> | undefined;
if (process.env.NODE_ENV !== "production") {
  multiWalletErrorMessages = {
    [MULTI_WALLET_ERROR__ACCOUNT_ALREADY_EXIST]: `The account you're trying to initialize already exists.`,
    [MULTI_WALLET_ERROR__DOMAIN_CONFIG_IS_DISABLED]: `The domain configuration account is currently disabled. Contact support or try again later.`,
    [MULTI_WALLET_ERROR__DOMAIN_CONFIG_IS_MISSING]: `Missing domain configuration account. Ensure it's passed in the instruction.`,
    [MULTI_WALLET_ERROR__DUPLICATE_MEMBER]: `Duplicate public keys detected in the member list. Each member must have a unique key.`,
    [MULTI_WALLET_ERROR__DURABLE_NONCE_DETECTED]: `This transaction includes a durable nonce, which is not supported by this program.`,
    [MULTI_WALLET_ERROR__EMPTY_MEMBERS]: `No members were provided. A multisig must have at least one member.`,
    [MULTI_WALLET_ERROR__FINAL_BUFFER_HASH_MISMATCH]: `The final hash of the buffer doesn't match what was expected. The buffer might be corrupted or altered.`,
    [MULTI_WALLET_ERROR__FINAL_BUFFER_SIZE_EXCEEDED]: `The serialized transaction buffer exceeds the maximum allowed size of 10,128 bytes.`,
    [MULTI_WALLET_ERROR__FINAL_BUFFER_SIZE_MISMATCH]: `The declared size of the buffer does not match its actual size.`,
    [MULTI_WALLET_ERROR__ILLEGAL_ACCOUNT_OWNER]: `The account is not owned by the multisig program. Ensure the correct program owns this account.`,
    [MULTI_WALLET_ERROR__INSUFFICIENT_SIGNERS_WITH_VOTE_PERMISSION]: `The approval threshold cannot be met because there aren't enough voters with the vote permission.`,
    [MULTI_WALLET_ERROR__INSUFFICIENT_SIGNER_WITH_EXECUTE_PERMISSION]: `At least one signer must have execute permissions to proceed.`,
    [MULTI_WALLET_ERROR__INSUFFICIENT_SIGNER_WITH_INITIATE_PERMISSION]: `At least one signer must have initiate permissions to perform this action.`,
    [MULTI_WALLET_ERROR__INSUFFIENT_SIGNER_WITH_DELEGATE_PERMISSION]: `A delegate account is required when the initial member has requested delegate permissions.`,
    [MULTI_WALLET_ERROR__INVALID_ACCOUNT]: `One or more accounts provided failed validation. Ensure all required accounts are included and correct.`,
    [MULTI_WALLET_ERROR__INVALID_BUFFER]: `The contents of the buffer do not match the expected hash. It may have been tampered with.`,
    [MULTI_WALLET_ERROR__INVALID_CHALLENGE]: `The challenge value in clientDataJSON is missing or doesn't match the expected challenge.`,
    [MULTI_WALLET_ERROR__INVALID_JSON]: `Failed to parse the client data JSON. The format may be invalid.`,
    [MULTI_WALLET_ERROR__INVALID_NUMBER_OF_ACCOUNTS]: `The number of provided accounts does not match what was expected for this instruction.`,
    [MULTI_WALLET_ERROR__INVALID_ORIGIN]: `The origin value in clientDataJSON does not match the expected domain.`,
    [MULTI_WALLET_ERROR__INVALID_SECP256R1_VERIFY_ARG]: `Missing or incorrectly formatted WebAuthn verification arguments. Please check the secp256r1 signature input.`,
    [MULTI_WALLET_ERROR__INVALID_SIGNED_MESSAGE]: `The provided signature doesn't match the expected message. Make sure you're signing the correct payload.`,
    [MULTI_WALLET_ERROR__INVALID_SYSVAR_DATA_FORMAT]: `Failed to parse sysvar: slot history format is invalid or corrupted.`,
    [MULTI_WALLET_ERROR__INVALID_THRESHOLD]: `Invalid threshold value. It must be at least 1 and not exceed the number of voting-eligible members.`,
    [MULTI_WALLET_ERROR__INVALID_TRANSACTION_MESSAGE]: `The transaction message structure is malformed or does not follow expected formatting.`,
    [MULTI_WALLET_ERROR__INVALID_TYPE]: `The type field in clientDataJSON is invalid. Expected value: webauthn.get.`,
    [MULTI_WALLET_ERROR__MAX_LENGTH_EXCEEDED]: `One of the input strings exceeds the maximum allowed character limit.`,
    [MULTI_WALLET_ERROR__MEMBER_DOES_NOT_BELONG_TO_DOMAIN_CONFIG]: `This member is not registered in the provided domain configuration.`,
    [MULTI_WALLET_ERROR__MISSING_ACCOUNT]: `A required account is missing from the transaction context.`,
    [MULTI_WALLET_ERROR__MISSING_CHALLENGE]: `Missing challenge field in clientDataJSON. This is required for validating the authentication request.`,
    [MULTI_WALLET_ERROR__MISSING_ORIGIN]: `Missing origin field in clientDataJSON. This field is required for WebAuthn validation.`,
    [MULTI_WALLET_ERROR__MISSING_SYSVAR_SLOT_HISTORY]: `The Slot History sysvar account is missing. It must be included as an account in this instruction.`,
    [MULTI_WALLET_ERROR__MISSING_TYPE]: `Missing type field in clientDataJSON. This field is required for WebAuthn validation.`,
    [MULTI_WALLET_ERROR__NO_SIGNER_FOUND]: `No valid signer was found in this transaction. Ensure at least one authorized signer is present.`,
    [MULTI_WALLET_ERROR__PROTECTED_ACCOUNT]: `Writable CPI calls to protected accounts are not permitted.`,
    [MULTI_WALLET_ERROR__RP_ID_HASH_MISMATCH]: `The relying party ID hash does not match the one specified in the domain configuration.`,
    [MULTI_WALLET_ERROR__SLOT_HASH_MISMATCH]: `The slot hash doesn't match the expected value from slot history.`,
    [MULTI_WALLET_ERROR__SLOT_NUMBER_NOT_FOUND]: `The specified slot number is not present in the provided slot history.`,
    [MULTI_WALLET_ERROR__TOO_MANY_MEMBERS]: `The number of members exceeds the supported maximum (65,535).`,
    [MULTI_WALLET_ERROR__TRANSACTION_HAS_EXPIRED]: `The transaction has expired. It must be executed within 3 minutes of approval.`,
    [MULTI_WALLET_ERROR__TRANSACTION_NOT_APPROVED]: `The transaction hasn't received enough approvals yet to be executed.`,
    [MULTI_WALLET_ERROR__UNAUTHORISED_TO_CLOSE_TRANSACTION_BUFFER]: `Only the transaction's creator or rent payer is allowed to close the transaction buffer.`,
  };
}

export function getMultiWalletErrorMessage(code: MultiWalletError): string {
  if (process.env.NODE_ENV !== "production") {
    return (multiWalletErrorMessages as Record<MultiWalletError, string>)[code];
  }

  return "Error message not available in production bundles.";
}

export function isMultiWalletError<TProgramErrorCode extends MultiWalletError>(
  error: unknown,
  transactionMessage: {
    instructions: Record<number, { programAddress: Address }>;
  },
  code?: TProgramErrorCode
): error is SolanaError<typeof SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM> &
  Readonly<{ context: Readonly<{ code: TProgramErrorCode }> }> {
  return isProgramError<TProgramErrorCode>(
    error,
    transactionMessage,
    MULTI_WALLET_PROGRAM_ADDRESS,
    code
  );
}

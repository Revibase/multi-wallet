import type {
  MessageAuthenticationResponse,
  TransactionDetails,
} from "@revibase/core";
import type {
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "gill";

export const RevibaseSignAndSendTransaction = "revibase:SignAndSendTransaction";
export type RevibaseSignAndSendTransactionMethod = (input: {
  instructions: Instruction[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  additionalSigners?: TransactionSigner[];
  cachedAccounts?: Map<string, any>;
}) => Promise<string>;
export type RevibaseSignAndSendTransactionFeature = {
  /** Name of the feature. */
  readonly [RevibaseSignAndSendTransaction]: {
    /** Version of the feature API. */
    readonly version: "1.0.0";

    /**
     * Build, Sign and Send transactions using the account's secret key.
     * Priority Fees and Compute Units are automatically added when sending the transaction.
     *
     * @param instructions instructions for building the transaction
     * @param addressLookupTableAddress optional lookup table
     * @param additionalSigners additional signers that needs to sign the transaction other than the current wallet signer
     *
     * @return Transaction Signature.
     */
    readonly signAndSendTransaction: RevibaseSignAndSendTransactionMethod;
  };
};

export const RevibaseBuildTransaction = "revibase:BuildTransaction";
export type RevibaseBuildTransactionMethod = (input: {
  instructions: Instruction[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  additionalSigners?: TransactionSigner[];
  cachedAccounts?: Map<string, any>;
}) => Promise<TransactionDetails[]>;
export type RevibaseBuildTransactionFeature = {
  /** Name of the feature. */
  readonly [RevibaseBuildTransaction]: {
    /** Version of the feature API. */
    readonly version: "1.0.0";

    /**
     * Build transactions using the account's secret key.
     *
     * @param instructions instructions for building the transaction
     * @param addressLookupTableAddress optional lookup table
     * @param additionalSigners additional signers that needs to sign the transaction other than the current wallet signer
     *
     * @return Transaction Details
     */
    readonly buildTransaction: RevibaseBuildTransactionMethod;
  };
};

export const RevibaseSignMessage = "revibase:SignMessage";
export type RevibaseSignMessageMethod = (
  message: string
) => Promise<MessageAuthenticationResponse>;
export type RevibaseSignMessageFeature = {
  /** Name of the feature. */
  readonly [RevibaseSignMessage]: {
    /** Version of the feature API. */
    readonly version: "1.0.0";

    /**
     * Sign transactions using the account's secret key.
     *
     * @param message message to be signed
     *
     * @return Message Authentication Response.
     */
    readonly signMessage: RevibaseSignMessageMethod;
  };
};

export const RevibaseVerifySignedMessage = "revibase:VerifySignedMessage";
export type RevibaseVerifySignedMessageMethod = (input: {
  message: string;
  authResponse: MessageAuthenticationResponse;
  expectedOrigin?: string;
}) => Promise<boolean>;
export type RevibaseVerifySignedMessageFeature = {
  /** Name of the feature. */
  readonly [RevibaseVerifySignedMessage]: {
    /** Version of the feature API. */
    readonly version: "1.0.0";

    /**
     * Sign transactions using the account's secret key.
     *
     * @param input Message Auth Response
     *
     * @return boolean
     */
    readonly verify: RevibaseVerifySignedMessageMethod;
  };
};

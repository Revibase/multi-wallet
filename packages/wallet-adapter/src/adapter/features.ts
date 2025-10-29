import type {
  JitoTipsConfig,
  MessageAuthenticationResponse,
  TransactionDetails,
} from "@revibase/core";
import type {
  AddressesByLookupTableAddress,
  Instruction,
  TransactionSigner,
} from "gill";

export const RevibaseSignTransaction = "revibase:SignTransaction";
export type RevibaseSignTransactionMethod = (input: {
  instructions: Instruction[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  additionalSigners?: TransactionSigner[];
  cachedAccounts?: Map<string, any>;
  jitoTipsConfig?: JitoTipsConfig;
}) => Promise<TransactionDetails[]>;
export type RevibaseSignTransactionFeature = {
  /** Name of the feature. */
  readonly [RevibaseSignTransaction]: {
    /** Version of the feature API. */
    readonly version: "1.0.0";

    /**
     * Sign transactions using the account's secret key.
     *
     * @param instructions instructions for building the transaction
     * @param addressLookupTableAddress optional lookup table
     * @param additionalSigners additional signers that needs to sign the transaction other than the current wallet signer
     *
     * @return Transaction Signature.
     */
    readonly signAndSendTransaction: RevibaseSignTransactionMethod;
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

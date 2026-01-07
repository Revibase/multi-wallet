import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";

export type TransactionAuthenticationResponse = TransactionDetails &
  AuthenticationContext &
  BaseResponse;

export type MessageAuthenticationResponse = AuthenticationContext &
  BaseResponse;

export type TransactionAuthDetails = TransactionDetails & AuthenticationContext;

type TransactionDetails = {
  transactionPayload: TransactionPayloadWithBase64MessageBytes;
  slotHash: string;
  slotNumber: string;
  originIndex: number;
  crossOrigin: boolean;
};

type AuthenticationContext = {
  authResponse: AuthenticationResponseJSON;
  nonce: string;
  clientSignature: {
    clientOrigin: string;
    signature: string;
  };
  deviceSignature: {
    publicKey: string;
    signature: string;
  };
  authProviderSignature?: {
    publicKey: string;
    signature: string;
  };
};

type BaseResponse = {
  signer: string;
  userAddressTreeIndex?: number;
  additionalInfo?: any;
};

export type TransactionPayloadWithBase64MessageBytes = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: string;
};

export type StartTransactionRequest = {
  phase: "start";
  redirectOrigin: string;
  signer?: string;
  data: {
    type: "transaction";
    payload: TransactionPayloadWithBase64MessageBytes;
  };
};

export type StartMessageRequest = {
  phase: "start";
  redirectOrigin: string;
  signer?: string;
  data: {
    type: "message";
    payload?: string;
  };
};

export type CompleteTransactionRequest = {
  phase: "complete";
  data: {
    type: "transaction";
    payload: Omit<TransactionAuthenticationResponse, "clientSignature"> & {
      clientSignature: { clientOrigin: string };
    };
  };
};

export type CompleteMessageRequest = {
  phase: "complete";
  data: {
    type: "message";
    payload: Omit<MessageAuthenticationResponse, "clientSignature"> & {
      clientSignature: { clientOrigin: string };
      id?: string;
      message: string;
    };
  };
};

export type TransactionActionType =
  | "create"
  | "create_with_preauthorized_execution"
  | "execute"
  | "vote"
  | "sync"
  | "close"
  | "compress"
  | "decompress"
  | "transfer_intent"
  | "change_delegate"
  | "change_config";

export type TransactionPayload = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: Uint8Array;
};

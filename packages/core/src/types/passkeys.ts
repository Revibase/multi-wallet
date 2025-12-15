import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";

export type TransactionAuthenticationResponse = TransactionAuthDetails & {
  type: "transaction";
  signer: string;
  userAddressTreeIndex?: number;
  slotNumber: string;
  additionalInfo?: any;
};

export type MessageAuthenticationResponse = {
  type: "message";
  authResponse: AuthenticationResponseJSON;
  signer: string;
  clientSignature: { clientOrigin: string };
  deviceSignature: { publicKey: string; signature: string };
  nonce: string;
  userAddressTreeIndex?: number;
  additionalInfo?: any;
};

export type TransactionAuthDetails = {
  authResponse: AuthenticationResponseJSON;
  transactionPayload: TransactionPayloadWithBase64MessageBytes;
  slotHash: string;
  clientSignature: { clientOrigin: string; signature: string };
  deviceSignature: { publicKey: string; signature: string };
  nonce: string;
  originIndex: number;
  crossOrigin: boolean;
};

type TransactionPayloadWithBase64MessageBytes = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: string;
};

export type ClientAuthorizationStartRequest = {
  phase: "start";
  data:
    | {
        type: "transaction";
        payload: TransactionPayloadWithBase64MessageBytes;
      }
    | { type: "message"; payload: string };
  redirectOrigin: string;
  signer?: string;
};

export type ClientAuthorizationCompleteRequest = {
  phase: "complete";
  data: {
    type: "transaction" | "message";
    sessionToken: string;
  };
};

export type ClientAuthorizationRequest =
  | ClientAuthorizationStartRequest
  | ClientAuthorizationCompleteRequest;

export type ClientAuthorizationResponse<T extends ClientAuthorizationRequest> =
  T["phase"] extends "start"
    ? string
    : T["data"]["type"] extends "transaction"
      ? TransactionAuthenticationResponse
      : MessageAuthenticationResponse | null;

export type ClientAuthorizationCallback = <
  T extends ClientAuthorizationRequest,
>(
  request: T
) => Promise<ClientAuthorizationResponse<T>>;

export type TransactionActionType =
  | "create"
  | "create_with_preauthorized_execution"
  | "execute"
  | "vote"
  | "sync"
  | "close"
  | "add_new_member"
  | "compress"
  | "decompress"
  | "transfer_intent"
  | "change_delegate";

export type TransactionPayload = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: Uint8Array;
};

export type MessagePayload = {
  message: string;
};

export type BasePayload = {
  signer?: string;
  popUp?: Window | null;
};

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

export type ClientAuthorizationStartRequest = {
  phase: "start";
  data:
    | {
        type: "transaction";
        payload: TransactionPayloadWithBase64MessageBytes;
      }
    | { id?: string; type: "message"; payload: string };
  redirectOrigin: string;
  signer?: string;
};

export type ClientAuthorizationCompleteRequest = {
  phase: "complete";
  data:
    | {
        type: "transaction";
        payload: Omit<TransactionAuthenticationResponse, "clientSignature"> & {
          clientSignature: { clientOrigin: string };
        };
      }
    | {
        id?: string;
        message: string;
        type: "message";
        payload: Omit<MessageAuthenticationResponse, "clientSignature"> & {
          clientSignature: { clientOrigin: string };
        };
      };
};

export type ClientAuthorizationCallback = {
  (
    request:
      | ClientAuthorizationStartRequest
      | ClientAuthorizationCompleteRequest
  ): Promise<string>;
};

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
  id?: string;
};

export type BasePayload = {
  signer?: string;
  popUp?: Window | null;
};

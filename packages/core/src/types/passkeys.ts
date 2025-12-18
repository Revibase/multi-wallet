import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";

export type TransactionAuthenticationResponse = TransactionAuthDetails & {
  signer: string;
  userAddressTreeIndex?: number;
  slotNumber: string;
  additionalInfo?: any;
};

export type MessageAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: string;
  userAddressTreeIndex?: number;
  nonce: string;
  clientSignature: { clientOrigin: string; signature: string };
  deviceSignature: { publicKey: string; signature: string };
  additionalInfo?: any;
};

export type TransactionAuthDetails = {
  transactionPayload: TransactionPayloadWithBase64MessageBytes;
  authResponse: AuthenticationResponseJSON;
  slotHash: string;
  nonce: string;
  clientSignature: { clientOrigin: string; signature: string };
  deviceSignature: { publicKey: string; signature: string };
  originIndex: number;
  crossOrigin: boolean;
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
        message?: string;
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

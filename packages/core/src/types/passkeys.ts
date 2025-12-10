import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Secp256r1Key } from "./secp256r1";

export type TransactionAuthenticationResponse = TransactionAuthDetails & {
  signer: Secp256r1Key;
  userAddressTreeIndex?: number;
  slotNumber: string;
  additionalInfo?: any;
};

export type TransactionAuthDetails = {
  authResponse: AuthenticationResponseJSON;
  transactionPayload: TransactionPayloadWithBase64MessageBytes;
  slotHash: string;
  clientId: string;
  deviceSignature: { publicKey: string; signature: string };
  nonce: string;
  originIndex: number;
  crossOrigin: boolean;
};

export type TransactionAuthDetailsWithClientSignature = Omit<
  TransactionAuthDetails,
  "clientId"
> & {
  clientSignature: { clientId: string; signature: string };
};

type TransactionPayloadWithBase64MessageBytes = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: string;
};

export type SignClientMessage = {
  (
    type: "start",
    message: string
  ): Promise<{ signature: string; expiry: number }>;
  (type: "complete", message: string): Promise<{ signature: string }>;
};

export type MessageAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: Secp256r1Key;
  clientId: string;
  deviceSignature: { publicKey: string; signature: string };
  nonce: string;
  userAddressTreeIndex?: number;
  additionalInfo?: any;
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
  | "transfer_intent";

export type TransactionPayload = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: Uint8Array;
};

export type MessagePayload = {
  message: string;
};

export type BasePayload = {
  signer?: Secp256r1Key;
  popUp?: Window | null;
};

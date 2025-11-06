import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Secp256r1Key } from "./secp256r1";

export type TransactionAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: Secp256r1Key;
  userAddressTreeIndex?: number;
  slotNumber: string;
  slotHash: string;
  additionalInfo?: any;
};

export type MessageAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: Secp256r1Key;
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

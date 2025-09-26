import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialHint,
} from "@simplewebauthn/server";
import type { Address } from "gill";

export type TransactionAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: string;
  slotNumber: string;
  slotHash: string;
  additionalInfo?: any;
};

export type MessageAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: string;
  additionalInfo?: any;
};

export type ParsedAuthenticationResponse = {
  verifyArgs: {
    clientDataJson: Uint8Array;
    slotNumber: bigint;
    slotHash: Uint8Array;
  };
  signer: string;
  domainConfig: Address;
  authData: Uint8Array;
  signature: Uint8Array;
};

export type TransactionActionType =
  | "create"
  | "create_with_permissionless_execution"
  | "execute"
  | "vote"
  | "sync"
  | "close"
  | "add_new_member"
  | "compress"
  | "decompress";

export type TransactionPayload = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: Uint8Array;
};

export type MessagePayload = {
  message: string;
};

export type BasePayload = {
  hints?: PublicKeyCredentialHint[];
  authUrl?: string;
  signer?: string;
  popUp?: Window | null;
  debug?: boolean;
  additionalInfo?: any;
};

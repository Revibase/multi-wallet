import {
  AuthenticationResponseJSON,
  PublicKeyCredentialHint,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { Address } from "@solana/kit";

export type AuthenticationResponse = {
  username: string;
  publicKey: string;
  authResponse: AuthenticationResponseJSON | RegistrationResponseJSON;
  slotNumber?: string;
  slotHash?: string;
};

export type ParsedAuthenticationResponse = {
  verifyArgs: {
    publicKey: Uint8Array;
    clientDataJson: Uint8Array;
    slotNumber: bigint;
    slotHash: Uint8Array;
  };
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
  | "token_transfer_intent"
  | "native_transfer_intent"
  | "compress"
  | "decompress";

export type TransactionPayload = {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: Uint8Array;
  additionalInfo?: any;
};

export type MessagePayload = {
  message: string;
};

export type BasePayload = {
  hints?: PublicKeyCredentialHint[];
  authUrl?: string;
  publicKey?: string;
  popUp?: Window | null;
  debug?: boolean;
  additionalInfo?: any;
};

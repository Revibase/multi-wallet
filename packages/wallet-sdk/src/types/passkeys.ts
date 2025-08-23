import {
  AuthenticationResponseJSON,
  PublicKeyCredentialHint,
} from "@simplewebauthn/server";
import { Address } from "@solana/kit";

export type AuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  slotNumber?: string;
  slotHash?: string;
};

export type ParsedAuthenticationResponse = {
  verifyArgs?: {
    clientDataJson: Uint8Array;
    slotNumber: bigint;
    slotHash: Uint8Array;
  };
  credentialId: string;
  domainConfig?: Address;
  authData?: Uint8Array;
  signature?: Uint8Array;
};

export type TransactionActionType =
  | "create"
  | "create_with_permissionless_execution"
  | "execute"
  | "vote"
  | "sync"
  | "close"
  | "create_new_wallet"
  | "add_new_member"
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
  credentialId?: string;
  transports?: string;
  popUp?: Window | null;
  debug?: boolean;
  additionalInfo?: any;
};

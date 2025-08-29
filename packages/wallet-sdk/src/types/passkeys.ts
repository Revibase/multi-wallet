import {
  AuthenticationResponseJSON,
  PublicKeyCredentialHint,
} from "@simplewebauthn/server";
import { Address } from "@solana/kit";

export type TransactionAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: SignerPayload;
  slotNumber: string;
  slotHash: string;
};

export type MessageAuthenticationResponse = {
  authResponse: AuthenticationResponseJSON;
  signer: SignerPayload;
};

export type ParsedAuthenticationResponse = {
  verifyArgs?: {
    clientDataJson: Uint8Array;
    slotNumber: bigint;
    slotHash: Uint8Array;
  };
  signer: SignerPayload;
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
};

export type MessagePayload = {
  message: string;
};

export type SignerPayload = {
  publicKey: string;
  credentialId: string;
  username?: string;
  transports?: string;
  settingsIndex?: number;
};

export type BasePayload = {
  hints?: PublicKeyCredentialHint[];
  authUrl?: string;
  signer?: SignerPayload;
  popUp?: Window | null;
  debug?: boolean;
  additionalInfo?: any;
};

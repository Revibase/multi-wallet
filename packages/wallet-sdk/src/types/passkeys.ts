import {
  AuthenticationResponseJSON,
  PublicKeyCredentialHint,
} from "@simplewebauthn/server";

export type AuthenticationResponse = AuthenticationResponseJSON & {
  username: string;
  publicKey: string;
  slotNumber?: string;
  slotHash?: string;
};

export type RegistrationResponse = {
  username: string;
  publicKey: string;
};

export type TransactionActionType =
  | "create"
  | "create_with_permissionless_execution"
  | "execute"
  | "vote"
  | "sync"
  | "close"
  | "change_config"
  | "add_new_member"
  | "token_transfer_intent"
  | "native_transfer_intent";

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

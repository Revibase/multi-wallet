import { AuthenticationResponseJSON } from "@simplewebauthn/server";

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
  | "execute"
  | "vote"
  | "close"
  | "sync"
  | "change_config"
  | "add_new_member";

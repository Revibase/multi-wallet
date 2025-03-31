import { AuthenticationResponseJSON } from "@simplewebauthn/server";

export type AuthenticationResponse = AuthenticationResponseJSON & {
  secp256r1PublicKey: string;
  slotNumber?: string;
  slotHash?: string;
};

export type TransactionActionType = "create" | "close" | "execute" | "vote";

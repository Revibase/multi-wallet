import type {
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";

export type ClientAuthorizationCallback = {
  (
    request: StartMessageRequest,
    signal: AbortSignal,
  ): Promise<{ user: UserInfo }>;
  (
    request: StartTransactionRequest,
    signal: AbortSignal,
  ): Promise<{ txSig?: string; user: UserInfo }>;
};

import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";
import type { PendingApprovalsCallbacks } from "./transactions/transaction-signer-options";

/** Authorize start request: POST request/device/channelId to backend, return result. */
export type ClientAuthorizationCallback = {
  (request: StartPayload): Promise<{ signature: string; validTill: number }>;
  (request: CompleteMessageRequest): Promise<{ user: UserInfo }>;
  (request: CompleteTransactionRequest): Promise<CompleteTransactionRequest>;
};

export type StartPayload =
  | Omit<StartMessageRequest, "validTill">
  | Omit<StartTransactionRequest, "validTill">;

/** signIn options. */
export type SignInAuthorizationFlowOptions = {
  signal?: AbortSignal;
};

/** transferTokens / executeTransaction options. */
export type TransactionAuthorizationFlowOptions = {
  confirmTransaction?: boolean;
  pendingApprovalsCallback?: PendingApprovalsCallbacks;
  signal?: AbortSignal;
};

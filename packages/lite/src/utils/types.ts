import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  KeyType,
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";
import type { PendingApprovalsCallbacks } from "./transactions/transaction-signer-options";

/** Authorize start request: POST request/device/channelId to backend, return result. */
export type ClientAuthorizationCallback = {
  (request: StartPayload): Promise<{ signature: string; validTill: number }>;
  (request: CompleteMessageRequest): Promise<void>;
  (request: CompleteTransactionRequest): Promise<{ signature: string }>;
};

export type OnConnectedCallback = (
  rid: string,
  clientOrigin: string,
) => Promise<{
  request: StartMessageRequest | StartTransactionRequest;
  signature: string;
  transactionManagerAddress?: string;
  additionalSigners?: string[];
  additionalVoters?: { keyType: KeyType; publicKey: string }[];
}>;

type SuccessMap = {
  message: { user: UserInfo };
  transaction: { txSig: string; user: UserInfo };
};

export type OnSuccessCallback =
  | ((req: CompleteMessageRequest) => Promise<SuccessMap["message"]>)
  | ((req: CompleteTransactionRequest) => Promise<SuccessMap["transaction"]>);

export type StartPayload =
  | Omit<StartMessageRequest, "validTill">
  | Omit<StartTransactionRequest, "validTill">;

/** signIn options. */
export type SignInAuthorizationFlowOptions = {
  requireTwoFactorAuthentication?: boolean;
  pendingApprovalsCallback?: PendingApprovalsCallbacks;
  signal?: AbortSignal;
};

/** transferTokens / executeTransaction options. */
export type TransactionAuthorizationFlowOptions = {
  confirmTransaction?: boolean;
  pendingApprovalsCallback?: PendingApprovalsCallbacks;
  signal?: AbortSignal;
};

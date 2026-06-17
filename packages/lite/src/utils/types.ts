import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  KeyType,
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";

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

/**
 * Progress of the post-approval phase (after the passkey is approved, while the
 * request is being completed/broadcast). The provider streams these to the
 * popup over the message channel for display; the host app does not see
 * them directly.
 */
export type FlowStatusReport =
  | { phase: "submitting" }
  | { phase: "pending_approval"; validTill: number }
  | { phase: "approved" }
  | { phase: "confirming" };

/** Context the provider injects into {@link OnSuccessCallback}. */
export type OnSuccessContext = {
  /** Report post-approval progress; forwarded to the popup for display. */
  reportStatus: (status: FlowStatusReport) => void;
  /** Aborts if the caller aborts or the user closes the popup mid-flight. */
  signal: AbortSignal;
};

export type OnSuccessCallback =
  | ((
      req: CompleteMessageRequest,
      ctx: OnSuccessContext,
    ) => Promise<SuccessMap["message"]>)
  | ((
      req: CompleteTransactionRequest,
      ctx: OnSuccessContext,
    ) => Promise<SuccessMap["transaction"]>);

export type StartPayload =
  | Omit<StartMessageRequest, "validTill">
  | Omit<StartTransactionRequest, "validTill">;

/** signIn options. */
export type SignInAuthorizationFlowOptions = {
  requireTwoFactorAuthentication?: boolean;
  signal?: AbortSignal;
};

/** transferTokens / executeTransaction options. */
export type TransactionAuthorizationFlowOptions = {
  confirmTransaction?: boolean;
  signal?: AbortSignal;
};

/**
 * Internal-only: public flow options plus the status reporter the provider
 * threads down into the send/approval path. Not part of the public API.
 */
export type InternalMessageFlowOptions = SignInAuthorizationFlowOptions & {
  reportStatus?: (status: FlowStatusReport) => void;
};
export type InternalTransactionFlowOptions =
  TransactionAuthorizationFlowOptions & {
    reportStatus?: (status: FlowStatusReport) => void;
  };

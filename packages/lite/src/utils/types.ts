import type {
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";

/** Device proof (public key + signature) when using a device-bound channel. */
export type DeviceSignature = { jwk: string; jws: string };

/** Callback invoked to authorize a start request. POST request/device/channelId to your backend and return the result. */
export type ClientAuthorizationCallback = {
  (
    request: StartMessageRequest,
    signal: AbortSignal,
    device?: DeviceSignature,
    channelId?: string,
  ): Promise<{ user: UserInfo }>;
  (
    request: StartTransactionRequest,
    signal: AbortSignal,
    device?: DeviceSignature,
    channelId?: string,
  ): Promise<{ txSig?: string; user: UserInfo }>;
};

/**
 * Options for signIn, transferTokens, and executeTransaction.
 *
 * @property signal - When aborted, the flow is cancelled and the request is not sent.
 * @property channelId - Use an existing channel (no popup); device-bound flow.
 */
export type AuthorizationFlowOptions = {
  signal?: AbortSignal;
  channelId?: string;
};

/** Result of signIn (user only) or transferTokens/executeTransaction (txSig + user). */
export type AuthorizationFlowResult =
  | { user: UserInfo }
  | { txSig?: string; user: UserInfo };

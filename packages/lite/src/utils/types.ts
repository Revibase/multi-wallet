import type {
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";

/** Device proof (jwk + jws) for channel auth. */
export type DeviceSignature = { jwk: string; jws: string };

/** Authorize start request: POST request/device/channelId to backend, return result. */
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

/** signIn / transferTokens / executeTransaction options. */
export type AuthorizationFlowOptions = {
  signal?: AbortSignal;
  channelId?: string;
};

/** signIn → user; transferTokens/executeTransaction → txSig? + user. */
export type AuthorizationFlowResult =
  | { user: UserInfo }
  | { txSig?: string; user: UserInfo };

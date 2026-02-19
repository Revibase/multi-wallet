import type {
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";

export type DeviceSignature = { jwk: string; jws: string };

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

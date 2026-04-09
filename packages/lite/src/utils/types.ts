import type {
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";
import z from "zod";

/** Device proof (jwk + jws) for channel auth. */
export type DeviceSignature = { jwk: string; jws: string };

/** Authorize start request: POST request/device/channelId to backend, return result. */
export type ClientAuthorizationCallback = {
  (
    request: StartMessageRequest,
    signal?: AbortSignal,
    device?: DeviceSignature,
    channelId?: string,
  ): Promise<{ user: UserInfo }>;
  (
    request: StartTransactionRequest,
    signal?: AbortSignal,
    device?: DeviceSignature,
    channelId?: string,
  ): Promise<{ txSig?: string; user: UserInfo }>;
  (
    request: StartChannelRequest,
    signal?: AbortSignal,
    device?: DeviceSignature,
    channelId?: string,
  ): Promise<{ ok: true }>;
};

/** signIn options. */
export type SignInAuthorizationFlowOptions = {
  trustedDeviceCheck?: boolean;
  signal?: AbortSignal;
  channelId?: string;
};

/** transferTokens / executeTransaction options. */
export type TransactionAuthorizationFlowOptions = {
  signal?: AbortSignal;
  channelId?: string;
};

/** signIn → user; transferTokens/executeTransaction → txSig? + user. */
export type AuthorizationFlowResult =
  | { user: UserInfo }
  | { txSig?: string; user: UserInfo };

export const StartChannelRequestSchema = z
  .object({
    phase: z.literal("start"),
    redirectOrigin: z.url(),
    data: z.object({
      type: z.literal("channel"),
      device: z.custom<DeviceSignature>(),
      channelId: z.string(),
    }),
  })
  .strict();

export type StartChannelRequest = z.infer<typeof StartChannelRequestSchema>;

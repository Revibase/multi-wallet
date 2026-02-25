import type {
  CompleteMessageRequest,
  CompleteSendTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
  UserInfo,
} from "@revibase/core";
import {
  StartMessageRequestSchema,
  StartTransactionRequestSchema,
} from "@revibase/core";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import type { DeviceSignature } from "src/utils";
import z from "zod";
import { startRequest } from "./startRequest";
import { validateMessage } from "./validateMessage";

/**
 * Validates the start request, calls Revibase start + getResult APIs, and returns user or tx result.
 * Pass your route's req.signal so fetches cancel when the client disconnects.
 *
 * @param options.request - The start message or transaction request from the client.
 * @param options.signal - AbortSignal (e.g. req.signal) to cancel fetches when the client disconnects.
 * @param options.privateKey - Base64-encoded JWK. Server-only; never pass from the client. Use an env var (e.g. PRIVATE_KEY).
 * @param options.channelId - Optional. Present when using a device-bound channel.
 * @param options.device - Optional. Device signature when channelId is used.
 * @param options.providerOrigin - Optional. Revibase auth origin. Defaults to production.
 * @param options.rpId - Optional. Relying party ID for WebAuthn.
 * @returns User info and, for transactions, the transaction signature.
 */
export async function processClientAuthCallback({
  request,
  privateKey,
  providerOrigin,
  rpId,
  signal,
  device,
  channelId,
}: {
  request: StartTransactionRequest | StartMessageRequest;
  signal: AbortSignal;
  privateKey: string;
  channelId?: string;
  device?: DeviceSignature;
  providerOrigin?: string;
  rpId?: string;
}): Promise<{ txSig?: string; user: UserInfo }> {
  const parsedResult = z
    .union([StartMessageRequestSchema, StartTransactionRequestSchema])
    .parse(request);

  const { data, signer, redirectOrigin, rid } = parsedResult;
  // Server always overwrites validTill and sendTx; client values are ignored.
  const validTill = Date.now() + DEFAULT_TIMEOUT;

  if (data.type === "message") {
    const result = (await startRequest({
      request: {
        phase: "start",
        redirectOrigin,
        signer,
        rid,
        validTill,
        data: {
          type: "message",
          payload: data.payload,
        },
      },
      privateKey,
      providerOrigin,
      signal,
      device,
      channelId,
    })) as CompleteMessageRequest;

    return validateMessage(
      { phase: "complete", data: result.data },
      providerOrigin,
      rpId,
    );
  }

  const result = (await startRequest({
    request: {
      phase: "start",
      redirectOrigin,
      signer,
      rid,
      validTill,
      data: {
        type: "transaction",
        payload: data.payload,
        sendTx: true,
        additionalSigners: data.additionalSigners,
      },
    },
    providerOrigin,
    privateKey,
    signal,
    device,
    channelId,
  })) as CompleteSendTransactionRequest;

  return {
    txSig: result.data.payload.txSig,
    user: result.data.payload.user,
  };
}

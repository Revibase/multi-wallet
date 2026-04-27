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
import {
  StartChannelRequestSchema,
  type DeviceSignature,
  type StartChannelRequest,
} from "src/utils";
import z from "zod";
import { startChannel } from "./startChannel";
import { startRequest } from "./startRequest";
import { validateMessage } from "./validateMessage";
import { withValidTillDeadline } from "./withValidTillDeadline";

/** Validates start request, calls Revibase start + getResult, returns user or tx. Pass req.signal for cancel on disconnect. */
export async function processClientAuthCallback({
  request,
  privateKey,
  providerOrigin,
  rpId,
  signal,
  device,
  channelId,
}: {
  request: StartTransactionRequest | StartMessageRequest | StartChannelRequest;
  signal?: AbortSignal;
  privateKey: string;
  channelId?: string;
  device?: DeviceSignature;
  providerOrigin?: string;
  rpId?: string;
}): Promise<{ txSig?: string; user?: UserInfo; ok?: boolean }> {
  const parsedResult = z
    .union([
      StartMessageRequestSchema,
      StartTransactionRequestSchema,
      StartChannelRequestSchema,
    ])
    .parse(request);

  const { data, redirectOrigin } = parsedResult;
  // Server always overwrites validTill and sendTx; client values are ignored.
  const validTill = Date.now() + DEFAULT_TIMEOUT;

  if (data.type === "message") {
    const result = (await withValidTillDeadline(
      validTill,
      signal,
      (requestSignal) =>
        startRequest({
          request: {
            phase: "start",
            redirectOrigin,
            signer: (parsedResult as StartMessageRequest).signer,
            rid: (parsedResult as StartMessageRequest).rid,
            validTill,
            data: {
              type: "message",
              payload: data.payload,
              trustedDeviceCheck: data.trustedDeviceCheck,
            },
          },
          privateKey,
          providerOrigin,
          signal: requestSignal,
          device,
          channelId,
        }),
    )) as CompleteMessageRequest;

    return validateMessage(
      { phase: "complete", data: result.data },
      providerOrigin,
      rpId,
    );
  } else if (data.type === "transaction") {
    const result = (await withValidTillDeadline(
      validTill,
      signal,
      (requestSignal) =>
        startRequest({
          request: {
            phase: "start",
            redirectOrigin,
            signer: (parsedResult as StartTransactionRequest).signer,
            rid: (parsedResult as StartTransactionRequest).rid,
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
          signal: requestSignal,
          device,
          channelId,
        }),
    )) as CompleteSendTransactionRequest;

    return {
      txSig: result.data.payload.txSig,
      user: result.data.payload.user,
    };
  } else {
    await startChannel({
      privateKey,
      request: {
        phase: "start",
        redirectOrigin,
        data: {
          channelId: data.channelId,
          device: data.device,
          type: "channel",
        },
      },
      signal,
      providerOrigin,
    });
    return { ok: true };
  }
}

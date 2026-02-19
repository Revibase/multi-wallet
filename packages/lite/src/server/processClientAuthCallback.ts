import type {
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
import { processGetResult } from "./processGetResult";
import { processMessage } from "./processMessage";
import { processStartRequest } from "./processStartRequest";

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

  if (data.type === "message") {
    await processStartRequest({
      request: {
        phase: "start",
        redirectOrigin,
        signer,
        rid,
        validTill: Date.now() + DEFAULT_TIMEOUT,
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
    });
  } else {
    await processStartRequest({
      request: {
        phase: "start",
        redirectOrigin,
        signer,
        rid,
        validTill: Date.now() + DEFAULT_TIMEOUT,
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
    });
  }

  const result = await processGetResult({
    rid,
    providerOrigin,
    privateKey,
    signal,
  });

  if (result.data.type === "message") {
    return {
      user: await processMessage(
        { phase: "complete", data: result.data },
        providerOrigin,
        rpId,
      ),
    };
  }

  return {
    txSig: result.data.payload.txSig,
    user: result.data.payload.user,
  };
}

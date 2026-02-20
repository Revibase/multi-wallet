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
    const result = (await startRequest({
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
  })) as CompleteSendTransactionRequest;

  return {
    txSig: result.data.payload.txSig,
    user: result.data.payload.user,
  };
}

import type {
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import {
  StartMessageRequestSchema,
  StartTransactionRequestSchema,
} from "@revibase/core";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import {
  CompleteMessageRequestSchema,
  CompleteTransactionRequestSchema,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type User,
} from "src/utils";
import z from "zod";
import { processGetResult } from "./processGetResult";
import { processMessage } from "./processMessage";
import { processStartRequest } from "./processStartRequest";

/**
 * Processes client authorization callbacks for both messages and transactions.
 * Handles the complete authentication and transaction flow.
 *
 * @param request - Start or complete request (message or transaction)
 * @param privateKey - Private Key JWK in base64
 * @param feePayer - Optional fee payer for transactions
 * @param providerOrigin - Optional expected origin for verification
 * @param rpId - Optional expected Relying Party ID for verification
 * @returns Result containing signature, message, user, or transaction signature
 * @throws {Error} If request phase or type is invalid
 */
export async function processClientAuthCallback({
  request,
  privateKey,
  providerOrigin,
  rpId,
}: {
  request:
    | StartTransactionRequest
    | StartMessageRequest
    | CompleteMessageRequest
    | CompleteTransactionRequest;
  privateKey: string;
  providerOrigin?: string;
  rpId?: string;
}): Promise<{ rid: string } | { user: User } | { txSig: string }> {
  const parsedResult = z
    .union([
      StartTransactionRequestSchema,
      StartMessageRequestSchema,
      CompleteTransactionRequestSchema,
      CompleteMessageRequestSchema,
    ])
    .parse(request);

  if (parsedResult.phase === "start") {
    const { data, signer, redirectOrigin, rid } = parsedResult;

    if (data.type === "message") {
      return await processStartRequest({
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
      });
    }

    return await processStartRequest({
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
        },
      },
      providerOrigin,
      privateKey,
    });
  }

  const result = await processGetResult({
    rid: parsedResult.data.rid,
    providerOrigin,
    privateKey,
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

  return { txSig: result.data.payload.txSig };
}

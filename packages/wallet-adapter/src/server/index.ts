import type {
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import {
  convertBase64StringToJWK,
  createClientAuthorizationCompleteRequestChallenge,
  StartMessageRequestSchema,
  StartTransactionRequestSchema,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import { CompactSign } from "jose";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import {
  CompleteCustomMessageRequestSchema,
  CompleteCustomTransactionRequestSchema,
  type CompleteCustomMessageRequest,
  type CompleteCustomTransactionRequest,
} from "src/utils";
import z from "zod";
import { processGetResult } from "./processGetResult";
import { processMessage } from "./processMessage";
import { processStartRequest } from "./processStartRequest";

/**
 * Processes client authorization callbacks for both message and transaction requests.
 *
 * This function handles the two-phase authentication flow:
 * - Start phase: Creates and signs a challenge
 * - Complete phase: Verifies and processes the authentication response
 *
 * @param request - Authorization request (start or complete phase)
 * @param privateKey - Private Key JWK in Base64 string
 * @param providerOrigin - Optional expected origin for verification
 * @param rpId - Optional expected Relying Party ID for verification
 * @returns Signature and optional message/user data depending on request phase and type
 * @throws {WalletVerificationError} If verification fails
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
    | CompleteCustomMessageRequest
    | CompleteCustomTransactionRequest;
  privateKey: string;
  providerOrigin?: string;
  rpId?: string;
}) {
  const parsedResult = z
    .union([
      StartTransactionRequestSchema,
      StartMessageRequestSchema,
      CompleteCustomTransactionRequestSchema,
      CompleteCustomMessageRequestSchema,
    ])
    .parse(request);

  if (parsedResult.phase === "start") {
    const { data, rid, redirectOrigin, signer } = parsedResult;
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
    } else {
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
            sendTx: false,
          },
        },
        providerOrigin,
        privateKey,
      });
    }
  }

  // Get result and process based on type
  const result = await processGetResult({
    rid: parsedResult.data.rid,
    providerOrigin,
    privateKey,
  });

  // Complete Request
  if (result.data.type === "message") {
    return {
      user: await processMessage(
        { phase: "complete", data: result.data },
        providerOrigin,
        rpId,
      ),
    };
  }

  const pkey = convertBase64StringToJWK(privateKey);
  if (!pkey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationCompleteRequestChallenge(result),
  )
    .setProtectedHeader({
      alg: pkey.alg,
    })
    .sign(pkey);

  const authResponse: TransactionAuthenticationResponse = {
    ...result.data.payload,
    client: {
      clientOrigin: result.data.payload.client.clientOrigin,
      jws: signature,
    },
  };

  return { authResponse };
}

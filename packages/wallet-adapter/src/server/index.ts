import {
  createClientAuthorizationCompleteRequestChallenge,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import { getBase58Decoder } from "gill";
import {
  CompleteCustomMessageRequestSchema,
  CompleteCustomTransactionRequestSchema,
  StartCustomMessageRequestSchema,
  StartCustomTransactionRequestSchema,
  type CompleteCustomMessageRequest,
  type CompleteCustomTransactionRequest,
  type StartCustomMessageRequest,
  type StartCustomTransactionRequest,
} from "src/utils";
import { createSignInMessageText } from "src/utils/internal";
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
 * @param privateKey - Ed25519 private key for signing challenges
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
    | StartCustomTransactionRequest
    | StartCustomMessageRequest
    | CompleteCustomMessageRequest
    | CompleteCustomTransactionRequest;
  privateKey: CryptoKey;
  providerOrigin?: string;
  rpId?: string;
}) {
  const parsedResult = z
    .union([
      StartCustomMessageRequestSchema,
      StartCustomTransactionRequestSchema,
      CompleteCustomTransactionRequestSchema,
      CompleteCustomMessageRequestSchema,
    ])
    .parse(request);

  if (parsedResult.phase === "start") {
    const { data } = parsedResult;
    if (data.type === "message") {
      return await processStartRequest({
        request: {
          phase: "start",
          redirectOrigin: parsedResult.redirectOrigin,
          signer: parsedResult.signer,
          data: {
            type: "message",
            payload: createSignInMessageText({
              domain: parsedResult.redirectOrigin,
              nonce: crypto.randomUUID(),
            }),
          },
        },
        privateKey,
        providerOrigin,
        rid: data.rid,
      });
    } else {
      return await processStartRequest({
        request: {
          phase: "start",
          redirectOrigin: parsedResult.redirectOrigin,
          signer: parsedResult.signer,
          data: {
            type: "transaction",
            payload: data.payload,
          },
        },
        providerOrigin,
        privateKey,
        rid: data.rid,
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

  const challenge = createClientAuthorizationCompleteRequestChallenge(result);
  const signature = getBase58Decoder().decode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        new Uint8Array(challenge),
      ),
    ),
  );

  const authResponse: TransactionAuthenticationResponse = {
    ...result.data.payload,
    clientSignature: {
      ...result.data.payload.clientSignature,
      signature,
    },
  };

  return { authResponse };
}

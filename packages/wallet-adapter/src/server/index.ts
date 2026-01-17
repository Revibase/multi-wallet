import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import {
  CompleteMessageRequestSchema,
  CompleteTransactionRequestSchema,
  createClientAuthorizationCompleteRequestChallenge,
  createClientAuthorizationStartRequestChallenge,
  StartMessageRequestSchema,
  StartTransactionRequestSchema,
} from "@revibase/core";
import { getBase58Decoder } from "gill";
import { WalletVerificationError } from "src/utils/errors";
import { createSignInMessageText } from "src/utils/internal";
import z from "zod";
import { processMessage } from "./processMessage";

/**
 * Processes client authorization callbacks for both message and transaction requests.
 *
 * This function handles the two-phase authentication flow:
 * - Start phase: Creates and signs a challenge
 * - Complete phase: Verifies and processes the authentication response
 *
 * @param request - Authorization request (start or complete phase)
 * @param privateKey - Ed25519 private key for signing challenges
 * @param expectedOrigin - Optional expected origin for verification
 * @param expectedRPID - Optional expected Relying Party ID for verification
 * @returns Signature and optional message/user data depending on request phase and type
 * @throws {WalletVerificationError} If verification fails
 */
export async function processClientAuthCallback({
  request,
  privateKey,
  expectedOrigin,
  expectedRPID,
}: {
  request:
    | StartTransactionRequest
    | StartMessageRequest
    | CompleteTransactionRequest
    | CompleteMessageRequest;
  privateKey: CryptoKey;
  expectedOrigin?: string;
  expectedRPID?: string;
}) {
  const parsedResult = z
    .union([
      StartMessageRequestSchema,
      StartTransactionRequestSchema,
      CompleteTransactionRequestSchema,
      CompleteMessageRequestSchema,
    ])
    .parse(request);

  if (parsedResult.phase === "start") {
    const { data } = parsedResult;
    if (data.type === "message") {
      const message =
        data.payload ??
        createSignInMessageText({
          nonce: crypto.randomUUID(),
        });
      const challenge = createClientAuthorizationStartRequestChallenge({
        ...parsedResult,
        data: { ...data, payload: message },
      });
      const signature = getBase58Decoder().decode(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "Ed25519" },
            privateKey,
            new Uint8Array(challenge),
          ),
        ),
      );
      return { signature, message };
    } else {
      const challenge =
        createClientAuthorizationStartRequestChallenge(parsedResult);
      const signature = getBase58Decoder().decode(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "Ed25519" },
            privateKey,
            new Uint8Array(challenge),
          ),
        ),
      );
      return { signature };
    }
  }

  // Complete Request
  if (parsedResult.data.type === "message") {
    const user = await processMessage(
      { phase: "complete", data: parsedResult.data },
      expectedOrigin,
      expectedRPID,
    );
    return { user };
  }
  const challenge =
    createClientAuthorizationCompleteRequestChallenge(parsedResult);
  const signature = getBase58Decoder().decode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        new Uint8Array(challenge),
      ),
    ),
  );

  return { signature };
}

import { equalBytes } from "@noble/curves/utils.js";
import type { CompleteTransactionRequest } from "@revibase/core";
import {
  bufferToBase64URLString,
  convertBase64StringToJWK,
  convertPubkeyCompressedToCose,
  createClientAuthorizationCompleteRequestChallenge,
  createClientAuthorizationStartRequestChallenge,
  createTransactionChallenge,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { CompactSign, compactVerify, importJWK } from "jose";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";

/** Verifies WebAuthn message, returns signature. */
export async function verifyTransaction(
  request: CompleteTransactionRequest,
  expectedClientJwk: string,
  allowedClientOrigins: string[],
  privateKey: string,
  expectedOrigin = REVIBASE_AUTH_URL,
  expectedRPID = REVIBASE_RP_ID,
): Promise<CompleteTransactionRequest> {
  const { payload } = request.data;
  if (payload.startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");
  if (
    Date.now() >
    Math.min(payload.startRequest.validTill, payload.estimatedSlotHashExpiry)
  ) {
    throw new Error("Request expired.");
  }
  if (
    !allowedClientOrigins.includes(payload.startRequest.clientOrigin) ||
    !allowedClientOrigins.includes(payload.client.clientOrigin) ||
    payload.startRequest.clientOrigin !== payload.client.clientOrigin
  ) {
    throw new Error("Invalid client origin");
  }

  const key = await importJWK(convertBase64StringToJWK(expectedClientJwk));
  const result = await compactVerify(request.data.payload.client.jws, key);
  if (
    !equalBytes(
      result.payload,
      createClientAuthorizationStartRequestChallenge(
        request.data.payload.startRequest,
      ),
    )
  ) {
    throw new Error("Invalid client signature");
  }

  const { challenge: expectedChallenge } = await createTransactionChallenge(
    payload.startRequest.data.payload,
    payload.startRequest.clientOrigin,
    payload.device.jwk,
    payload.startRequest.rid,
    payload.slotHash,
    payload.slotNumber,
    payload.estimatedSlotHashExpiry,
  );
  const { verified } = await verifyAuthenticationResponse({
    response: payload.authResponse,
    expectedChallenge: bufferToBase64URLString(expectedChallenge),
    expectedRPID,
    expectedOrigin,
    requireUserVerification: false,
    credential: {
      counter: 0,
      id: payload.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(payload.signer),
    },
  });

  if (!verified) {
    throw new Error("Invalid client siganture");
  }
  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationCompleteRequestChallenge(request),
  )
    .setProtectedHeader({
      alg: pKey.alg,
    })
    .sign(pKey);

  return {
    ...request,
    data: {
      ...request.data,
      payload: {
        ...request.data.payload,
        client: { ...request.data.payload.client, jws: signature },
      },
    },
  };
}

import { equalBytes } from "@noble/curves/utils.js";
import type { CompleteMessageRequest } from "@revibase/core";
import {
  bufferToBase64URLString,
  convertBase64StringToJWK,
  convertPubkeyCompressedToCose,
  createClientAuthorizationStartRequestChallenge,
  createMessageChallenge,
  UserInfoSchema,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { compactVerify, importJWK } from "jose";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";

/** Verifies WebAuthn message, returns user. */
export async function verifyMessage(
  request: CompleteMessageRequest,
  expectedClientJwk: string,
  allowedClientOrigins: string[],
  expectedOrigin = REVIBASE_AUTH_URL,
  expectedRPID = REVIBASE_RP_ID,
) {
  const { payload } = request.data;
  if (payload.startRequest.data.type !== "message")
    throw new Error("Invalid request type.");
  if (Date.now() > payload.startRequest.validTill) {
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

  const expectedChallenge = createMessageChallenge(
    payload.startRequest.data.payload,
    payload.startRequest.clientOrigin,
    payload.device.jwk,
    payload.startRequest.rid,
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
  return {
    user: UserInfoSchema.parse(request.data.payload.additionalInfo),
  };
}

import type { CompleteMessageRequest } from "@revibase/core";
import {
  bufferToBase64URLString,
  convertPubkeyCompressedToCose,
  createMessageChallenge,
  UserInfoSchema,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";

/** Verifies WebAuthn message, returns user. */
export async function validateMessage(
  request: CompleteMessageRequest,
  expectedOrigin = REVIBASE_AUTH_URL,
  expectedRPID = REVIBASE_RP_ID,
) {
  const { payload } = request.data;
  if (payload.startRequest.data.type !== "message")
    throw new Error("Invalid request type.");

  const message = payload.startRequest.data.payload;
  const expectedChallenge = createMessageChallenge(
    message,
    payload.client.clientOrigin,
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
    throw new Error("WebAuthn message verification failed");
  }

  return {
    user: UserInfoSchema.parse(payload.additionalInfo),
  };
}

import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { MessageAuthenticationResponse } from "../types";
import {
  convertPubkeyCompressedToCose,
  getAuthEndpoint,
  getRpId,
} from "../utils";
import { bufferToBase64URLString } from "../utils/passkeys/internal";

export async function verifyMessage({
  message,
  response,
  expectedRPID = getRpId(),
  expectedOrigin = getAuthEndpoint(),
}: {
  message: string;
  response: MessageAuthenticationResponse;
  expectedRPID?: string;
  expectedOrigin?: string;
}): Promise<boolean> {
  const { verified } = await verifyAuthenticationResponse({
    response: response.authResponse,
    expectedChallenge: bufferToBase64URLString(
      new Uint8Array([
        ...new TextEncoder().encode(response.requestedClient),
        ...new TextEncoder().encode(message),
      ])
    ),
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
    credential: {
      id: response.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(response.signer.toString()),
      counter: 0,
    },
  });

  return verified;
}

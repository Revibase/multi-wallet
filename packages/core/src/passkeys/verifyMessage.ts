import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { MessageAuthenticationResponse } from "../types";
import { convertPubkeyCompressedToCose, getAuthEndpoint } from "../utils";
import { REVIBASE_RP_ID } from "../utils/consts";
import { bufferToBase64URLString } from "../utils/passkeys/internal";

export async function verifyMessage({
  message,
  response,
  expectedOrigin = getAuthEndpoint(),
}: {
  message: string;
  response: MessageAuthenticationResponse;
  expectedOrigin?: string;
}): Promise<boolean> {
  const { verified } = await verifyAuthenticationResponse({
    response: response.authResponse,
    expectedChallenge: bufferToBase64URLString(
      new TextEncoder().encode(message)
    ),
    expectedOrigin,
    expectedRPID: REVIBASE_RP_ID,
    requireUserVerification: false,
    credential: {
      id: response.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(response.signer.toString()),
      counter: 0,
    },
  });

  return verified;
}

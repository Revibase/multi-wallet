import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { MessageAuthenticationResponse } from "../types";
import { convertPubkeyCompressedToCose, getAuthUrl } from "../utils";
import { REVIBASE_RP_ID } from "../utils/consts";
import { bufferToBase64URLString } from "../utils/passkeys/internal";

export async function verifyMessage({
  message,
  response,
  expectedOrigin = getAuthUrl(),
  expectedRPID = REVIBASE_RP_ID,
}: {
  message: string;
  response: MessageAuthenticationResponse;
  expectedOrigin?: string;
  expectedRPID?: string;
}): Promise<boolean> {
  const { verified } = await verifyAuthenticationResponse({
    response: response.authResponse,
    expectedChallenge: bufferToBase64URLString(
      new TextEncoder().encode(message)
    ),
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
    credential: {
      id: response.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(response.signer),
      counter: 0,
    },
  });

  return verified;
}

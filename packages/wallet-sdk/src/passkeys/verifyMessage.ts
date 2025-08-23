import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { AuthenticationResponse } from "../types";
import { convertPubkeyCompressedToCose } from "../utils";
import { bufferToBase64URLString } from "../utils/passkeys/internal";

export async function verifyMessage({
  message,
  response,
  publicKey,
  expectedOrigin = "https://auth.revibase.com",
  expectedRPID = "revibase.com",
}: {
  message: string;
  response: AuthenticationResponse;
  publicKey: string;
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
      publicKey: convertPubkeyCompressedToCose(publicKey),
      counter: 0,
    },
  });

  return verified;
}

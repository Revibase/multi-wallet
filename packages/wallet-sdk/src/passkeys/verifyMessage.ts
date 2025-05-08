import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { AuthenticationResponse } from "../types";
import { convertPubkeyCompressedToCose } from "../utils";
import { bufferToBase64URLString } from "../utils/passkeys/internal";

export async function verifyMessage({
  message,
  response,
  expectedOrigin = "https://auth.revibase.com",
  expectedRPID = "revibase.com",
}: {
  message: string;
  response: AuthenticationResponse;
  expectedOrigin?: string;
  expectedRPID?: string;
}): Promise<boolean> {
  const publicKey = convertPubkeyCompressedToCose(response.publicKey);
  const { verified } = await verifyAuthenticationResponse({
    response,
    expectedChallenge: bufferToBase64URLString(
      new TextEncoder().encode(message)
    ),
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
    credential: {
      id: response.id,
      publicKey,
      counter: 0,
    },
  });

  return verified;
}

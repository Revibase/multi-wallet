import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  AuthenticationResponse,
  convertPubkeyCompressedToCose,
  DEFAULT_AUTH_URL,
  DEFAULT_RP_ID,
} from "./utils";
import { bufferToBase64URLString } from "./utils/internal";

export async function verifyMessage({
  message,
  response,
  expectedOrigin = DEFAULT_AUTH_URL,
  expectedRPID = DEFAULT_RP_ID,
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

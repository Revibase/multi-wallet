import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { AuthenticationResponse } from "../types";
import { convertPubkeyCompressedToCose } from "../utils";
import {
  bufferToBase64URLString,
  isAuthenticationResponseJSON,
} from "../utils/passkeys/internal";

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
  let verified = false;
  if (isAuthenticationResponseJSON(response.authResponse)) {
    ({ verified } = await verifyAuthenticationResponse({
      response: response.authResponse,
      expectedChallenge: bufferToBase64URLString(
        new TextEncoder().encode(message)
      ),
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
      credential: {
        id: response.authResponse.id,
        publicKey,
        counter: 0,
      },
    }));
  } else {
    ({ verified } = await verifyRegistrationResponse({
      response: response.authResponse,
      expectedChallenge: bufferToBase64URLString(
        new TextEncoder().encode(message)
      ),
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
    }));
  }

  return verified;
}

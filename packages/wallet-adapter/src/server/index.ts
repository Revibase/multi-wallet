import {
  bufferToBase64URLString,
  convertPubkeyCompressedToCose,
} from "@revibase/core";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";

export async function verifyMessage(
  response: AuthenticationResponseJSON,
  expectedChallenge: Uint8Array,
  expectedSigner: string,
  expectedOrigin = REVIBASE_AUTH_URL,
  expectedRPID = REVIBASE_RP_ID
) {
  const { verified } = await verifyAuthenticationResponse({
    response,
    expectedChallenge: bufferToBase64URLString(expectedChallenge),
    expectedRPID,
    expectedOrigin,
    requireUserVerification: false,
    credential: {
      counter: 0,
      id: response.id,
      publicKey: convertPubkeyCompressedToCose(expectedSigner),
    },
  });
  return verified;
}

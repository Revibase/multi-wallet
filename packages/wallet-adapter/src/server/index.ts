import {
  bufferToBase64URLString,
  convertPubkeyCompressedToCose,
  getAuthEndpoint,
  getRpId,
} from "@revibase/core";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";

export async function verifyMessage(
  response: AuthenticationResponseJSON,
  expectedChallenge: Uint8Array,
  expectedSigner: string,
  expectedOrigin = getAuthEndpoint(),
  expectedRPID = getRpId()
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

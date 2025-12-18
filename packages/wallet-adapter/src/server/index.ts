import {
  convertPubkeyCompressedToCose,
  getAuthEndpoint,
  getRpId,
} from "@revibase/core";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";

export async function verifyMessage(
  expectedChallenge: string,
  expectedSigner: string,
  response: AuthenticationResponseJSON
) {
  const { verified } = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedRPID: getRpId(),
    expectedOrigin: getAuthEndpoint(),
    requireUserVerification: false,
    credential: {
      counter: 0,
      id: response.id,
      publicKey: convertPubkeyCompressedToCose(expectedSigner),
    },
  });
  return verified;
}

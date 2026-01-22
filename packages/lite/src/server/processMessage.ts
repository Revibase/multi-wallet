import type { CompleteMessageRequest } from "@revibase/core";
import {
  bufferToBase64URLString,
  convertPubkeyCompressedToCose,
  createMessageChallenge,
  getWalletAddressFromIndex,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { UserSchema } from "src/utils";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";
import { getSettingsIndexWithAddress } from "src/utils/internal";

/**
 * Processes a WebAuthn message authentication request.
 * Verifies the authentication response and returns user information.
 *
 * @param request - Complete message request
 * @param expectedOrigin - Expected origin for WebAuthn verification (defaults to REVIBASE_AUTH_URL)
 * @param expectedRPID - Expected RP ID for WebAuthn verification (defaults to REVIBASE_RP_ID)
 * @returns User information including public key, wallet address, and settings
 * @throws {Error} If message verification fails or user has no delegated wallet
 */
export async function processMessage(
  request: CompleteMessageRequest,
  expectedOrigin = REVIBASE_AUTH_URL,
  expectedRPID = REVIBASE_RP_ID,
) {
  const { payload } = request.data;

  const message = payload.message;
  const expectedChallenge = createMessageChallenge(
    message,
    payload.clientSignature.clientOrigin,
    payload.deviceSignature.publicKey,
    payload.nonce,
  );
  const { verified } = await verifyAuthenticationResponse({
    response: payload.authResponse,
    expectedChallenge: bufferToBase64URLString(expectedChallenge),
    expectedRPID,
    expectedOrigin,
    requireUserVerification: false,
    credential: {
      counter: 0,
      id: payload.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(payload.signer),
    },
  });

  if (!verified) {
    throw new Error("WebAuthn message verification failed");
  }
  const settingsIndexWithAddress = await getSettingsIndexWithAddress(request);
  const walletAddress = await getWalletAddressFromIndex(
    settingsIndexWithAddress.index,
  );

  const user = {
    publicKey: payload.signer,
    walletAddress,
    settingsIndexWithAddress,
    ...payload.additionalInfo,
  };

  return UserSchema.parse(user);
}

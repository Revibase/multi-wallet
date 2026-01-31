import type {
  CompleteMessageRequest,
  SettingsIndexWithAddressArgs,
} from "@revibase/core";
import {
  bufferToBase64URLString,
  convertPubkeyCompressedToCose,
  createMessageChallenge,
  getWalletAddressFromIndex,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { UserSchema } from "src/utils";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";
import { WalletVerificationError } from "src/utils/errors";

/**
 * Processes and verifies a complete message authentication request.
 *
 * This function verifies the WebAuthn authentication response and extracts user information
 * from the verified message payload.
 *
 * @param request - Complete message request with authentication data
 * @param expectedOrigin - Expected origin for verification (defaults to REVIBASE_AUTH_URL)
 * @param expectedRPID - Expected Relying Party ID for verification (defaults to REVIBASE_RP_ID)
 * @returns User information including public key, wallet address, and settings
 * @throws {WalletVerificationError} If message verification fails or user has no delegated wallet
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
    payload.client.clientOrigin,
    payload.device.jwk,
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
    throw new WalletVerificationError("Unable to verify message");
  }
  const settingsIndexWithAddress = request.data.payload.additionalInfo
    ?.settingsIndexWithAddress as SettingsIndexWithAddressArgs | undefined;
  if (!settingsIndexWithAddress) {
    throw new WalletVerificationError(
      "User does not have a delegated wallet address.",
    );
  }
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

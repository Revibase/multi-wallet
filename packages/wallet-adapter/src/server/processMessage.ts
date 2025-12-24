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
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";

export async function processMessage(
  request: CompleteMessageRequest,
  expectedOrigin = REVIBASE_AUTH_URL,
  expectedRPID = REVIBASE_RP_ID
) {
  const { payload } = request.data;
  const message = payload.message;
  const expectedChallenge = createMessageChallenge(
    message,
    payload.clientSignature.clientOrigin,
    payload.deviceSignature.publicKey,
    payload.nonce
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
    throw new Error("Unable to verify message");
  }
  const settingsIndexWithAddress: SettingsIndexWithAddressArgs | undefined =
    request.data.payload.additionalInfo.settingsIndexWithAddress;
  if (!settingsIndexWithAddress) {
    throw new Error("User does not have a delegated wallet address.");
  }
  const walletAddress = await getWalletAddressFromIndex(
    settingsIndexWithAddress.index
  );

  const user = {
    publicKey: payload.signer,
    walletAddress,
    settingsIndexWithAddress,
    ...payload.additionalInfo,
  };
  return user;
}

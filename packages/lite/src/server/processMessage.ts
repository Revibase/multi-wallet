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
import { UserSchema, type User } from "src/utils";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";

export async function processMessage(
  request: CompleteMessageRequest,
  expectedOrigin = REVIBASE_AUTH_URL,
  expectedRPID = REVIBASE_RP_ID,
) {
  const { payload } = request.data;
  if (payload.startRequest.data.type !== "message")
    throw new Error("Invalid request type.");

  const message = payload.startRequest.data.payload;
  const expectedChallenge = createMessageChallenge(
    message,
    payload.client.clientOrigin,
    payload.device.jwk,
    payload.startRequest.rid,
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

  const settingsIndexWithAddress = payload.additionalInfo
    ?.settingIndexWithAddress as SettingsIndexWithAddressArgs | undefined;

  if (!settingsIndexWithAddress) {
    throw new Error("User is not delegated");
  }

  const walletAddress = await getWalletAddressFromIndex(
    settingsIndexWithAddress.index,
  );

  const user: User = {
    publicKey: payload.signer,
    walletAddress,
    settingsIndexWithAddress,
    ...payload.additionalInfo,
  };

  return UserSchema.parse(user);
}

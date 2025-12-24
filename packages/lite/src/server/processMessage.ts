import type { CompleteMessageRequest } from "@revibase/core";
import {
  bufferToBase64URLString,
  convertPubkeyCompressedToCose,
  createMessageChallenge,
  fetchSettingsAccountData,
  getWalletAddressFromIndex,
  UserRole,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "src/utils/consts";
import { getSettingsIndexWithAddress } from "src/utils/internal";

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
  const settingsIndexWithAddress = await getSettingsIndexWithAddress(request);
  const walletAddress = await getWalletAddressFromIndex(
    settingsIndexWithAddress.index
  );
  const settings = await fetchSettingsAccountData(
    settingsIndexWithAddress.index,
    settingsIndexWithAddress.settingsAddressTreeIndex
  );
  const hasTxManager = settings.members.some(
    (x) => x.role === UserRole.TransactionManager
  );
  const user = {
    publicKey: payload.signer,
    walletAddress,
    settingsIndexWithAddress,
    hasTxManager,
    ...payload.additionalInfo,
  };
  return user;
}

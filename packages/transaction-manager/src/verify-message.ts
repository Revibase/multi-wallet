import {
  convertMemberKeyToString,
  createClientAuthorizationStartRequestChallenge,
  createMessageChallenge,
  fetchSettingsAccountData,
  fetchUserAccountByFilters,
  getDomainConfigAddress,
  getSettingsFromIndex,
  getWalletAddressFromIndex,
  Secp256r1Key,
  UserRole,
  type CompleteMessageRequest,
} from "@revibase/core";
import type { VerifyMessageResult, WellKnownClientEntry } from "./types";
import {
  verifyClientSignature,
  verifyDeviceSignature,
  verifyUserSignature,
} from "./utils/signature-verification";

export async function verifyMessage(
  publicKey: string,
  payload: CompleteMessageRequest,
  getClientDetails?: (clientOrigin: string) => Promise<WellKnownClientEntry>,
): Promise<VerifyMessageResult> {
  const { startRequest, authResponse } = payload.data.payload;
  if (startRequest.data.type !== "message")
    throw new Error("Invalid request type.");
  if (Date.now() > startRequest.validTill) {
    throw new Error("Request expired.");
  }

  const [clientDetails] = await Promise.all([
    verifyClientSignature(
      payload.data.payload.client,
      createClientAuthorizationStartRequestChallenge(startRequest),
      getClientDetails,
    ),
    verifyDeviceSignature(
      payload.data.payload.device,
      payload.data.payload.authResponse,
    ),
    verifyUserSignature(payload),
  ]);

  const user = await fetchUserAccountByFilters(
    await getDomainConfigAddress({ rpId: startRequest.rpId }),
    { credentialId: authResponse.id },
  );

  if (!user) {
    throw new Error("No user found.");
  }
  const delegateTo = user?.wallets.find((x) => x.isDelegate);
  if (!delegateTo) {
    throw new Error("User does not have a delegated wallet");
  }
  const settingsData = await fetchSettingsAccountData(
    await getSettingsFromIndex(delegateTo.index),
  );
  const transactionManager = settingsData.members.find(
    (x) => x.role === UserRole.TransactionManager,
  );
  if (!transactionManager) {
    throw new Error("No transaction manager found.");
  }
  if (publicKey !== convertMemberKeyToString(transactionManager.pubkey)) {
    throw new Error("Transaction manager mismatch.");
  }

  const messageBytes = createMessageChallenge(
    payload.data.payload.startRequest.data.payload,
    payload.data.payload.startRequest.clientOrigin,
    payload.data.payload.device.jwk,
    payload.data.payload.startRequest.rid,
  );

  return {
    messageBytes,
    verificationResults: {
      payload,
      signer: {
        client: {
          origin: payload.data.payload.startRequest.clientOrigin,
          ...clientDetails,
        },
        device: payload.data.payload.device.deviceProfile,
        estimatedValidTill: payload.data.payload.startRequest.validTill,
        signer: new Secp256r1Key(convertMemberKeyToString(user.member)),
        startRequest: payload.data.payload.startRequest,
        walletAddress: await getWalletAddressFromIndex(delegateTo.index),
      },
    },
  };
}

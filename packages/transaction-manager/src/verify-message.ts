import {
  convertMemberKeyToString,
  createClientAuthorizationStartRequestChallenge,
  fetchSettingsAccountData,
  fetchUserAccountByFilters,
  getDomainConfigAddress,
  getSecp256r1MessageHash,
  getSettingsFromIndex,
  getWalletAddressFromIndex,
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
      getSecp256r1MessageHash(payload.data.payload.authResponse),
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

  return {
    payload,
    clientDetails,
    user: {
      publicKey: convertMemberKeyToString(user.member),
      walletAddress: (
        await getWalletAddressFromIndex(delegateTo.index)
      ).toString(),
      settingsIndexWithAddress: {
        index: Number(delegateTo.index),
        settingsAddressTreeIndex: delegateTo.settingsAddressTreeIndex,
      },
    },
  };
}

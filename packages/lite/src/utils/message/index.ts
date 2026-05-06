import type { UserInfo } from "@revibase/core";
import {
  convertMemberKeyToString,
  fetchSettingsAccountData,
  fetchUserAccountData,
  getSettingsFromIndex,
  UserRole,
  type CompleteMessageRequest,
} from "@revibase/core";
import { address } from "gill";
import { withRetry } from "../retry";
import type { SignInAuthorizationFlowOptions } from "../types";
import { fetchSignatureFromTransactionManager } from "./fetchSIgnatureFromTransactionManager";

export async function send2FARequestIfNeeded(
  user: UserInfo,
  request: CompleteMessageRequest,
  options?: SignInAuthorizationFlowOptions,
): Promise<{ publicKey: string; signature: string } | null> {
  const { startRequest } = request.data.payload;

  if (!startRequest.data.requireTwoFactorAuthentication) {
    return null;
  }

  if (!user.settingsIndexWithAddress) {
    throw new Error("User does not have a delegated wallet");
  }
  const settingsData = await withRetry(async () =>
    fetchSettingsAccountData(
      await getSettingsFromIndex(user.settingsIndexWithAddress!.index),
    ),
  );
  const transactionManager = settingsData.members.find(
    (x) => x.role === UserRole.TransactionManager,
  );
  if (!transactionManager) {
    throw new Error("No transaction manager found.");
  }
  const publicKey = convertMemberKeyToString(transactionManager.pubkey);
  const userAccountData = await withRetry(() =>
    fetchUserAccountData(
      address(publicKey),
      transactionManager.userAddressTreeIndex,
    ),
  );
  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error("No transaction manager url found.");
  }
  const signature = await fetchSignatureFromTransactionManager({
    payload: request,
    url: userAccountData.transactionManagerUrl.value,
    options,
  });

  return { publicKey, signature };
}

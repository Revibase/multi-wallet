import type { UserInfo } from "@revibase/core";
import {
  convertMemberKeyToString,
  fetchSettings,
  fetchUser,
  getSettingsFromIndex,
  getSolanaRpc,
  getUserAddress,
  UserRole,
  type CompleteMessageRequest,
} from "@revibase/core";
import { address } from "@solana/kit";
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

  const settingsData = (
    await withRetry(async () =>
      fetchSettings(
        getSolanaRpc(),
        await getSettingsFromIndex(user.settingsIndexWithAddress.index),
      ),
    )
  ).data;
  const transactionManager = settingsData.members.find(
    (x) => x.role === UserRole.TransactionManager,
  );
  if (!transactionManager) {
    throw new Error("No transaction manager found.");
  }
  const publicKey = convertMemberKeyToString(transactionManager.pubkey);
  const userAccountData = (
    await withRetry(async () =>
      fetchUser(getSolanaRpc(), await getUserAddress(address(publicKey))),
    )
  ).data;
  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error("No transaction manager url found.");
  }
  const signature = await fetchSignatureFromTransactionManager({
    data: {
      publicKey,
      payload: request,
    },
    url: userAccountData.transactionManagerUrl.value,
    options,
  });

  return { publicKey, signature };
}

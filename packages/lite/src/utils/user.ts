import {
  convertMemberKeyToString,
  getWalletAddressFromIndex,
  type User,
} from "@revibase/core";

export async function convertToUserInfo(user: User) {
  const delegateTo = user.wallets.find((x) => x.isDelegate);
  if (!delegateTo) {
    throw new Error("User has no delegated wallet.");
  }
  return {
    publicKey: convertMemberKeyToString(user.member),
    walletAddress: (
      await getWalletAddressFromIndex(delegateTo?.index)
    ).toString(),
    settingsIndexWithAddress: {
      index: Number(delegateTo.index),
      settingsAddressTreeIndex: delegateTo.settingsAddressTreeIndex,
    },
  };
}

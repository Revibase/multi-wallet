import { type TransactionSigner } from "gill";
import { getCreateWalletInstruction } from "../../generated";
import {
  getGlobalCounterAddress,
  getSettingsFromIndex,
  getUserAddress,
} from "../../utils";

type CreateWalletArgs = {
  index: number | bigint;
  payer: TransactionSigner;
  initialMember: TransactionSigner;
};
export async function createWallet({
  index,
  payer,
  initialMember,
}: CreateWalletArgs) {
  return getCreateWalletInstruction({
    globalCounter: await getGlobalCounterAddress(),
    userAccount: await getUserAddress(initialMember.address),
    settingsIndex: index,
    settings: await getSettingsFromIndex(index),
    payer,
    initialMember,
    remainingAccounts: [],
  });
}

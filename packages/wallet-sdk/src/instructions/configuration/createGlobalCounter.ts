import type { TransactionSigner } from "gill";
import { getCreateGlobalCounterInstructionAsync as getCreateGlobalCounterInstruction } from "../../generated";
import { getGlobalCounterAddress } from "../../utils";

export async function createGlobalCounter({
  payer,
}: {
  payer: TransactionSigner;
}) {
  const globalCounter = await getGlobalCounterAddress();
  return getCreateGlobalCounterInstruction({
    payer,
    globalCounter,
    remainingAccounts: [],
  });
}

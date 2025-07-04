import { TransactionSigner } from "@solana/kit";
import { getCreateGlobalCounterInstructionAsync } from "../../generated";

export async function createGlobalCounter({
  payer,
}: {
  payer: TransactionSigner;
}) {
  return await getCreateGlobalCounterInstructionAsync({
    payer,
  });
}

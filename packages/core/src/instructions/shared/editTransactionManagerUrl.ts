import type { TransactionSigner } from "gill";
import { getEditTransactionManagerUrlInstruction } from "../../generated";
import { getUserAddress } from "../../utils";

export async function editTransactionManagerUrl({
  signer,
  transactionManagerUrl,
}: {
  signer: TransactionSigner;
  transactionManagerUrl: string;
}) {
  return getEditTransactionManagerUrlInstruction({
    signer,
    transactionManagerAccount: await getUserAddress(signer.address),
    transactionManagerUrl,
    remainingAccounts: [],
  });
}

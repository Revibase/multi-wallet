import type { TransactionSigner } from "gill";
import { getEditUserExtensionInstruction } from "../../generated";
import { getUserExtensionsAddress } from "../../utils";

export async function editUserExtensions({
  payer,
  transactionManagerUrl,
}: {
  payer: TransactionSigner;
  transactionManagerUrl: string;
}) {
  const userExtensions = await getUserExtensionsAddress(payer.address);
  return getEditUserExtensionInstruction({
    payer,
    apiUrl: transactionManagerUrl,
    userExtensions,
    remainingAccounts: [],
  });
}

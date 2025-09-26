import type { TransactionSigner } from "gill";
import { getEditUserExtensionInstruction } from "../../generated";
import { getUserExtensionsAddress } from "../../utils";

export async function editUserExtensions({
  authority,
  apiUrl,
}: {
  authority: TransactionSigner;
  apiUrl: string;
}) {
  const userExtensions = await getUserExtensionsAddress(authority.address);
  return getEditUserExtensionInstruction({
    authority,
    apiUrl,
    userExtensions,
    remainingAccounts: [],
  });
}

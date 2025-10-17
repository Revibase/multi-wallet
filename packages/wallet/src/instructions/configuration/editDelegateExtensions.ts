import type { TransactionSigner } from "gill";
import { getEditDelegateExtensionInstruction } from "../../generated";
import { getDelegateExtensionsAddress } from "../../utils";

export async function editDelegateExtensions({
  authority,
  apiUrl,
}: {
  authority: TransactionSigner;
  apiUrl: string;
}) {
  const delegateExtensions = await getDelegateExtensionsAddress(
    authority.address
  );
  return getEditDelegateExtensionInstruction({
    authority,
    apiUrl,
    delegateExtensions: delegateExtensions,
    remainingAccounts: [],
  });
}

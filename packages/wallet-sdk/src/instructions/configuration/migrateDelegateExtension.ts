import { AccountRole, type Address, type TransactionSigner } from "gill";
import { getMigrateDelegateExtensionInstruction } from "../../generated";
import { getDelegateExtensionsAddress } from "../../utils";

export async function migrateDelegateExtension({
  authority,
  apiUrl,
  member,
}: {
  authority: TransactionSigner;
  apiUrl: string;
  member: Address;
}) {
  return getMigrateDelegateExtensionInstruction({
    apiUrl,
    member,
    authority,
    remainingAccounts: [
      {
        address: await getDelegateExtensionsAddress(member),
        role: AccountRole.WRITABLE,
      },
    ],
  });
}

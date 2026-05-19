import { type Address, none, some, type TransactionSigner } from "gill";
import { getEditDomainConfigInstruction } from "../../generated";
import { getUserAddress } from "../../utils";

export async function editDomainConfig({
  authority,
  domainConfig,
  newAuthority,
  newOrigins,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  newAuthority?: TransactionSigner;
  newOrigins?: string[];
}) {
  return getEditDomainConfigInstruction({
    domainConfig,
    authority,
    newOrigins: newOrigins ? some(newOrigins) : none(),
    newAuthority,
    userAccount: newAuthority
      ? await getUserAddress(newAuthority.address)
      : undefined,
    remainingAccounts: [],
  });
}

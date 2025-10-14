import { type Address, none, some, type TransactionSigner } from "gill";
import { getEditDomainConfigInstruction } from "../../generated";

export async function editDomainConfig({
  authority,
  domainConfig,
  newAuthority,
  newOrigins,
  newMetadataUrl,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  newAuthority?: Address;
  newOrigins?: string[];
  newMetadataUrl?: string;
}) {
  return getEditDomainConfigInstruction({
    domainConfig,
    authority,
    newOrigins: newOrigins ? some(newOrigins) : none(),
    newAuthority: newAuthority ? some(newAuthority) : none(),
    newMetadataUrl: newMetadataUrl ? some(newMetadataUrl) : none(),
    remainingAccounts: [],
  });
}

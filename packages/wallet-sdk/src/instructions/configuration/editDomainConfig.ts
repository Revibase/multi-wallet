import { Address, none, some, TransactionSigner } from "@solana/kit";
import { getEditDomainConfigInstruction } from "../../generated";

export async function editDomainConfig({
  authority,
  domainConfig,
  newAuthority,
  newOrigins,
}: {
  domainConfig: Address;
  authority: TransactionSigner;
  newAuthority?: Address;
  newOrigins?: string[];
}) {
  return getEditDomainConfigInstruction({
    domainConfig,
    authority,
    newOrigins: newOrigins ? some(newOrigins) : none(),
    newAuthority: newAuthority ? some(newAuthority) : none(),
  });
}

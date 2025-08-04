import { Address, TransactionSigner } from "@solana/kit";
import { getEditDomainConfigInstruction } from "../../generated";
import { getDomainConfig } from "../../utils";

export async function editDomainConfig({
  newAuthority,
  newOrigins,
  currentAuthority,
  rpId,
}: {
  rpId: string;
  newAuthority: Address;
  newOrigins: string[];
  currentAuthority: TransactionSigner;
}) {
  const domainConfig = await getDomainConfig({ rpId });
  return getEditDomainConfigInstruction({
    domainConfig,
    newOrigins,
    authority: currentAuthority,
    newAuthority,
  });
}

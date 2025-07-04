import { Address, TransactionSigner } from "@solana/kit";
import { getEditDomainConfigInstruction } from "../../generated";
import { getDomainConfig } from "../../utils";

export async function editDomainConfig({
  newAuthority,
  origin,
  currentAuthority,
  rpId,
}: {
  rpId: string;
  newAuthority: Address;
  origin: string;
  currentAuthority: TransactionSigner;
}) {
  const domainConfig = await getDomainConfig({ rpId });
  return getEditDomainConfigInstruction({
    domainConfig,
    newOrigin: origin,
    authority: currentAuthority,
    newAuthority,
  });
}

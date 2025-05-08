import { address, TransactionSigner } from "@solana/kit";
import { getEditDomainConfigInstruction } from "../../generated";
import { getDomainConfig } from "../../utils";

export async function editDomainConfig({
  newAuthority,
  origin,
  currentAuthority,
  rpId,
}: {
  rpId: string;
  newAuthority: string;
  origin: string;
  currentAuthority: TransactionSigner;
}) {
  const domainConfig = await getDomainConfig({ rpId });
  return getEditDomainConfigInstruction({
    domainConfig,
    origin,
    authority: currentAuthority,
    authorityArg: address(newAuthority),
  });
}

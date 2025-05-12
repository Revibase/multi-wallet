import { TransactionSigner } from "@solana/kit";
import { getDeleteDomainConfigInstruction } from "../../generated";
import { getDomainConfig } from "../../utils";

export async function deleteDomainConfig({
  authority,
  rpId,
}: {
  authority: TransactionSigner;
  rpId: string;
}) {
  const domainConfig = await getDomainConfig({ rpId });
  return getDeleteDomainConfigInstruction({
    domainConfig,
    authority,
  });
}

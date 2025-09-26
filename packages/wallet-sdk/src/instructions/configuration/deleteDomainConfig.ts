import type { TransactionSigner } from "gill";
import { getDeleteDomainConfigInstruction } from "../../generated";
import { getDomainConfigAddress } from "../../utils";

export async function deleteDomainConfig({
  authority,
  rpId,
}: {
  authority: TransactionSigner;
  rpId: string;
}) {
  const domainConfig = await getDomainConfigAddress({ rpId });
  return getDeleteDomainConfigInstruction({
    domainConfig,
    authority,
    remainingAccounts: [],
  });
}

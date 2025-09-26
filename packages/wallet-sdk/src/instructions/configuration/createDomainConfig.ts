import type { Address, TransactionSigner } from "gill";
import { getCreateDomainConfigInstruction } from "../../generated";
import { getDomainConfigAddress } from "../../utils";

export async function createDomainConfig({
  payer,
  rpId,
  origins,
  authority,
}: {
  payer: TransactionSigner;
  rpId: string;
  origins: string[];
  authority: Address;
}) {
  const domainConfig = await getDomainConfigAddress({ rpId });
  return getCreateDomainConfigInstruction({
    origins,
    authority,
    payer,
    domainConfig,
    rpId,
    remainingAccounts: [],
  });
}

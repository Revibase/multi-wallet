import type { TransactionSigner } from "gill";
import { getDisableDomainConfigInstruction } from "../../generated";
import { getDomainConfigAddress } from "../../utils";

export async function disableDomainConfig({
  admin,
  rpId,
  disable,
}: {
  admin: TransactionSigner;
  disable: boolean;
  rpId: string;
}) {
  const domainConfig = await getDomainConfigAddress({ rpId });
  return getDisableDomainConfigInstruction({
    domainConfig,
    admin,
    disable,
    remainingAccounts: [],
  });
}

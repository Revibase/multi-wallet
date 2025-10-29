import { type Address, type TransactionSigner } from "gill";
import { getCreateDomainConfigInstruction } from "../../generated";
import { getDomainConfigAddress } from "../../utils";

export async function createDomainConfig({
  payer,
  rpId,
  origins,
  authority,
  metadataUrl,
  adminDomainConfig,
}: {
  metadataUrl: string;
  payer: TransactionSigner;
  rpId: string;
  origins: string[];
  authority: Address;
  adminDomainConfig?: Address;
}) {
  const domainConfig = await getDomainConfigAddress({ rpId });
  return getCreateDomainConfigInstruction({
    origins,
    authority,
    payer,
    domainConfig,
    rpId,
    metadataUrl,
    adminDomainConfig,
    remainingAccounts: [],
  });
}

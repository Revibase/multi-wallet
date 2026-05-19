import { type TransactionSigner } from "gill";
import { getCreateDomainConfigInstruction } from "../../generated";
import { getDomainConfigAddress, getUserAddress } from "../../utils";

export async function createDomainConfig({
  payer,
  rpId,
  origins,
  authority,
}: {
  payer: TransactionSigner;
  rpId: string;
  origins: string[];
  authority: TransactionSigner;
}) {
  const domainConfig = await getDomainConfigAddress({ rpId });

  return getCreateDomainConfigInstruction({
    origins,
    authority,
    payer,
    domainConfig,
    rpId,
    userAccount: await getUserAddress(authority.address),
    remainingAccounts: [],
  });
}

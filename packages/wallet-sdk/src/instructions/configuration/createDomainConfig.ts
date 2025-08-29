import { Address, TransactionSigner } from "@solana/kit";
import { getCreateDomainConfigInstruction } from "../../generated";
import { getDomainConfigAddress } from "../../utils";
import { getHash } from "../../utils/transactionMessage/internal";

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
  const rpIdHash = getHash(new TextEncoder().encode(rpId));
  const domainConfig = await getDomainConfigAddress({ rpIdHash });
  return getCreateDomainConfigInstruction({
    rpIdHash,
    origins,
    authority,
    payer,
    domainConfig,
    rpId,
  });
}

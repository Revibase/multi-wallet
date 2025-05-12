import { Address, TransactionSigner } from "@solana/kit";
import { getCreateDomainConfigInstruction } from "../../generated";
import { getDomainConfig } from "../../utils";
import { getHash } from "../../utils/internal";

export async function createDomainConfig({
  payer,
  rpId,
  origin,
  authority,
}: {
  payer: TransactionSigner;
  rpId: string;
  origin: string;
  authority: Address;
}) {
  const rpIdHash = await getHash(rpId);
  const domainConfig = await getDomainConfig({ rpIdHash });
  return getCreateDomainConfigInstruction({
    rpIdHash,
    origin,
    authority,
    payer,
    domainConfig,
    rpId,
  });
}

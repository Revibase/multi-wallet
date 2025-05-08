import { address, TransactionSigner } from "@solana/kit";
import { getCreateDomainConfigInstruction } from "../../generated";
import { getDomainConfig } from "../../utils";
import { ADMIN } from "../../utils/consts";
import { getHash } from "../../utils/internal";

export async function createDomainConfig({
  admin,
  rpId,
  origin,
  authority,
}: {
  admin: TransactionSigner;
  rpId: string;
  origin: string;
  authority: string;
}) {
  if (admin.address !== ADMIN) {
    throw new Error("Your signer is unauthorised to use this action.");
  }
  const rpIdHash = await getHash(rpId);
  const domainConfig = await getDomainConfig({ rpIdHash });
  return getCreateDomainConfigInstruction({
    rpIdHash,
    origin,
    authority: address(authority),
    admin,
    domainConfig,
    rpId,
  });
}

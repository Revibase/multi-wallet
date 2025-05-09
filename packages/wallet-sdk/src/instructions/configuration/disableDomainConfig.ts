import { TransactionSigner } from "@solana/kit";
import { getDisableDomainConfigInstruction } from "../../generated";
import { getDomainConfig } from "../../utils";
import { ADMIN } from "../../utils/consts";

export async function disableDomainConfig({
  admin,
  rpId,
  disable,
}: {
  admin: TransactionSigner;
  disable: boolean;
  rpId: string;
}) {
  if (admin.address !== ADMIN) {
    throw new Error("Your signer is unauthorised to use this action.");
  }
  const domainConfig = await getDomainConfig({ rpId });
  return getDisableDomainConfigInstruction({
    domainConfig,
    admin,
    disable,
  });
}

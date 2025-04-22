import { Address, TransactionSigner } from "@solana/kit";
import { getEditDomainConfigInstruction } from "../generated";
import { getDomainConfig } from "../utils";

export async function editDomainConfig({
  payer,
  origin,
  authority,
  rpId,
}: {
  rpId: string;
  payer: TransactionSigner;
  origin: string;
  authority: Address;
}) {
  const domainConfig = await getDomainConfig({ rpId });

  return getEditDomainConfigInstruction({
    domainConfig,
    payer,
    origin,
    authority,
  });
}

import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { getDomainConfig, program } from "../utils";

export async function editDomainConfig({
  payer,
  origin,
  authority,
  rpId,
}: {
  rpId: string;
  payer: PublicKey;
  origin: string;
  authority: PublicKey;
}) {
  const domainConfig = getDomainConfig(sha256(new TextEncoder().encode(rpId)));
  const editDomainConfigIx = await program.methods
    .editDomainConfig({
      origin: origin,
      authority,
    })
    .accountsPartial({
      payer,
      domainConfig,
    })
    .instruction();
  return editDomainConfigIx;
}

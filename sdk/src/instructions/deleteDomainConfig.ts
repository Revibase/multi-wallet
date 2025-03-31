import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { getDomainConfig, program } from "../utils";

export async function deleteDomainConfig({
  payer,
  rpId,
}: {
  payer: PublicKey;
  rpId: string;
}) {
  const domainConfig = getDomainConfig(sha256(new TextEncoder().encode(rpId)));
  const deleteDomainConfigIx = await program.methods
    .deleteDomainConfig()
    .accountsPartial({
      payer,
      domainConfig,
    })
    .instruction();
  return deleteDomainConfigIx;
}

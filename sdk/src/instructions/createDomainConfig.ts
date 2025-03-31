import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { program } from "../utils";

export async function createDomainConfig({
  payer,
  rpId,
  origin,
  authority,
}: {
  payer: PublicKey;
  rpId: string;
  origin: string;
  authority: PublicKey;
}) {
  const createDomainConfigIx = await program.methods
    .createDomainConfig({
      rpIdHash: Array.from(sha256(new TextEncoder().encode(rpId))),
      origin: origin,
      authority,
    })
    .accounts({
      payer,
    })
    .instruction();
  return createDomainConfigIx;
}

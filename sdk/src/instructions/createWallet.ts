import { Keypair, PublicKey } from "@solana/web3.js";
import { Member, Permission, Permissions } from "../types";
import {
  convertPubkeyToMemberkey,
  getDelegateAddress,
  program,
} from "../utils";

export async function createWallet({
  feePayer,
  walletAddress,
  metadata,
}: {
  feePayer: PublicKey;
  walletAddress: Member;
  metadata: PublicKey | null;
}) {
  const delegate = Permissions.has(
    walletAddress.permissions,
    Permission.IsDelegate
  )
    ? getDelegateAddress(walletAddress.pubkey)
    : null;

  const createKey = Keypair.generate();
  const createWalletIx = await program.methods
    .create(
      {
        ...walletAddress,
        pubkey: convertPubkeyToMemberkey(walletAddress.pubkey),
      },
      createKey.publicKey,
      metadata
    )
    .accountsPartial({
      delegate,
      payer: feePayer,
      program: program.programId,
    })
    .instruction();

  return createWalletIx;
}

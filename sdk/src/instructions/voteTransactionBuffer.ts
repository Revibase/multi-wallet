import { Connection, PublicKey } from "@solana/web3.js";

import { fetchSecp256r1VerifyArgs } from "../functions";
import { Secp256r1Key } from "../types";
import { isPublicKey, program } from "../utils";

export async function voteTransactionBuffer({
  feePayer,
  settings,
  voter,
  transactionBufferAddress,
  transactionMessageBytes,
  connection,
}: {
  feePayer: PublicKey;
  settings: PublicKey;
  voter: PublicKey | Secp256r1Key;
  transactionBufferAddress: PublicKey;
  transactionMessageBytes?: Buffer;
  connection?: Connection;
}) {
  const { verifyArgs, domainConfig } = await fetchSecp256r1VerifyArgs(
    "vote",
    voter,
    connection,
    transactionBufferAddress,
    transactionMessageBytes
  );

  const transactionBufferIx = await program.methods
    .transactionBufferVote(verifyArgs)
    .accountsPartial({
      transactionBuffer: transactionBufferAddress,
      settings,
      domainConfig,
      payer: feePayer,
      voter: isPublicKey(voter) ? new PublicKey(voter) : null,
    })
    .instruction();
  return transactionBufferIx;
}

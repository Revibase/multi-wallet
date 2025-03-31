import { Connection, PublicKey } from "@solana/web3.js";

import { fetchSecp256r1VerifyArgs } from "../functions";
import { Secp256r1Key } from "../types";
import { isPublicKey, program } from "../utils";

export async function closeTransactionBuffer({
  closer,
  transactionBufferAddress,
  connection,
  transactionMessageBytes,
}: {
  closer: PublicKey | Secp256r1Key;
  transactionBufferAddress: PublicKey;
  connection?: Connection;
  transactionMessageBytes?: Buffer;
}) {
  const { verifyArgs, domainConfig } = await fetchSecp256r1VerifyArgs(
    "close",
    closer,
    connection,
    transactionBufferAddress,
    transactionMessageBytes
  );
  const ix = await program.methods
    .transactionBufferClose(verifyArgs)
    .accountsPartial({
      transactionBuffer: transactionBufferAddress,
      domainConfig,
      closer: isPublicKey(closer) ? new PublicKey(closer) : null,
    })
    .instruction();

  return ix;
}

import { sha256 } from "@noble/hashes/sha256";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { fetchSecp256r1VerifyArgs } from "../functions";
import { Secp256r1Key } from "../types";
import { convertPubkeyToMemberkey, isPublicKey, program } from "../utils";

export async function createTransactionBuffer({
  feePayer,
  transactionMessageBytes,
  settings,
  creator,
  bufferIndex,
  transactionBufferAddress,
  connection,
}: {
  feePayer: PublicKey;
  transactionMessageBytes: Buffer;
  settings: PublicKey;
  creator: PublicKey | Secp256r1Key;
  bufferIndex: number;
  transactionBufferAddress: PublicKey;
  connection?: Connection;
}) {
  const hash = sha256(transactionMessageBytes);

  let messageBytePart1 = transactionMessageBytes;
  let messageBytePart2: Buffer<ArrayBufferLike> | null = null;

  if (transactionMessageBytes.length > 900) {
    messageBytePart1 = transactionMessageBytes.subarray(0, 900);
    messageBytePart2 = transactionMessageBytes.subarray(900);
  }

  const { verifyArgs, domainConfig } = await fetchSecp256r1VerifyArgs(
    "create",
    creator,
    connection,
    transactionBufferAddress,
    transactionMessageBytes
  );

  const transactionBufferIx = await program.methods
    .transactionBufferCreate(
      {
        bufferIndex,
        finalBufferHash: Array.from(hash),
        finalBufferSize: transactionMessageBytes.length,
        buffer: messageBytePart1,
        creator: convertPubkeyToMemberkey(creator),
      },
      verifyArgs
    )
    .accountsPartial({
      settings,
      domainConfig,
      rentPayer: feePayer,
      creator: isPublicKey(creator) ? new PublicKey(creator) : null,
      transactionBuffer: transactionBufferAddress,
    })
    .instruction();

  let transactionBufferExtendIx: TransactionInstruction | null = null;
  if (messageBytePart2) {
    transactionBufferExtendIx = await program.methods
      .transactionBufferExtend(
        {
          buffer: messageBytePart2,
        },
        verifyArgs
      )
      .accountsPartial({
        transactionBuffer: transactionBufferAddress,
        domainConfig,
        creator: isPublicKey(creator) ? new PublicKey(creator) : null,
      })
      .instruction();
  }

  return {
    transactionBufferIx,
    transactionBufferExtendIx,
  };
}

import { Address, TransactionSigner } from "@solana/kit";
import {
  getTransactionBufferCreateInstruction,
  getTransactionBufferExtendInstruction,
} from "../generated";
import { Secp256r1Key } from "../types";
import { extractSecp256r1VerificationArgs } from "../utils/private";

export async function createTransactionBuffer({
  feePayer,
  transactionMessageBytes,
  settings,
  creator,
  bufferIndex,
  transactionBufferAddress,
}: {
  feePayer: TransactionSigner;
  transactionMessageBytes: Uint8Array;
  settings: Address;
  creator: TransactionSigner | Secp256r1Key;
  bufferIndex: number;
  transactionBufferAddress: Address;
}) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", transactionMessageBytes)
  );

  let messageBytePart1 = transactionMessageBytes;
  let messageBytePart2: Uint8Array | null = null;

  if (transactionMessageBytes.length > 900) {
    messageBytePart1 = transactionMessageBytes.subarray(0, 900);
    messageBytePart2 = transactionMessageBytes.subarray(900);
  }

  const { slotHashSysvar, domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(creator);

  const transactionBufferCreateIx = getTransactionBufferCreateInstruction({
    slotHashSysvar,
    bufferIndex,
    finalBufferHash: hash,
    finalBufferSize: transactionMessageBytes.length,
    settings,
    transactionBuffer: transactionBufferAddress,
    rentPayer: feePayer,
    buffer: messageBytePart1,
    secp256r1VerifyArgs: verifyArgs,
    creator: creator instanceof Secp256r1Key ? undefined : creator,
    domainConfig,
  });

  let transactionBufferExtendIx = null;
  if (messageBytePart2) {
    transactionBufferExtendIx = getTransactionBufferExtendInstruction({
      transactionBuffer: transactionBufferAddress,
      buffer: messageBytePart2,
      secp256r1VerifyArgs: verifyArgs,
      domainConfig,
      creator: creator instanceof Secp256r1Key ? undefined : creator,
    });
  }

  return {
    transactionBufferCreateIx,
    transactionBufferExtendIx,
  };
}

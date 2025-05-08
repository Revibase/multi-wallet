import { address, TransactionSigner } from "@solana/kit";
import { getTransactionBufferCreateInstruction } from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";

export function createTransactionBuffer({
  feePayer,
  transactionMessageBytes,
  settings,
  creator,
  bufferIndex,
  transactionBufferAddress,
  finalBufferHash,
  finalBufferSize,
  permissionlessExecution,
  bufferExtendHashes,
}: {
  finalBufferHash: Uint8Array;
  finalBufferSize: number;
  feePayer: TransactionSigner;
  transactionMessageBytes: Uint8Array;
  settings: string;
  creator: TransactionSigner | Secp256r1Key;
  bufferIndex: number;
  transactionBufferAddress: string;
  permissionlessExecution: boolean;
  bufferExtendHashes: Uint8Array[];
}) {
  const { slotHashSysvar, domainConfig, verifyArgs } =
    extractSecp256r1VerificationArgs(creator);

  return getTransactionBufferCreateInstruction({
    slotHashSysvar,
    bufferIndex,
    finalBufferHash,
    finalBufferSize,
    settings: address(settings),
    transactionBuffer: address(transactionBufferAddress),
    payer: feePayer,
    buffer: transactionMessageBytes,
    secp256r1VerifyArgs: verifyArgs,
    creator: creator instanceof Secp256r1Key ? undefined : creator,
    domainConfig,
    permissionlessExecution,
    bufferExtendHashes,
  });
}

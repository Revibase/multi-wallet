import { Address, IInstruction, TransactionSigner } from "@solana/kit";
import { getTransactionBufferCreateInstruction } from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function createTransactionBuffer({
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
  settings: Address;
  creator: TransactionSigner | Secp256r1Key;
  bufferIndex: number;
  transactionBufferAddress: Address;
  permissionlessExecution: boolean;
  bufferExtendHashes: Uint8Array[];
}) {
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(creator);
  const instructions: IInstruction[] = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([
        {
          message,
          signature,
          publicKey,
        },
      ])
    );
  }

  instructions.push(
    getTransactionBufferCreateInstruction({
      instructionsSysvar,
      slotHashSysvar,
      bufferIndex,
      finalBufferHash,
      finalBufferSize,
      settings,
      transactionBuffer: transactionBufferAddress,
      payer: feePayer,
      buffer: transactionMessageBytes,
      secp256r1VerifyArgs: verifyArgs,
      creator: creator instanceof Secp256r1Key ? undefined : creator,
      domainConfig,
      permissionlessExecution,
      bufferExtendHashes,
    })
  );
  return instructions;
}

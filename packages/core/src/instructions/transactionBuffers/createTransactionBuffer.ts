import type { Address, TransactionSigner } from "gill";
import {
  getTransactionBufferCreateInstruction,
  type ExpectedSignerArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export function createTransactionBuffer({
  payer,
  creator,
  bufferIndex,
  settings,
  transactionBufferAddress,
  finalBufferHash,
  finalBufferSize,
  preauthorizeExecution,
  bufferExtendHashes,
  expectedSigners,
}: {
  finalBufferHash: Uint8Array<ArrayBuffer>;
  finalBufferSize: number;
  payer: TransactionSigner;
  creator: TransactionSigner | SignedSecp256r1Key;
  settings: Address;
  bufferIndex: number;
  transactionBufferAddress: Address;
  preauthorizeExecution: boolean;
  bufferExtendHashes: Uint8Array<ArrayBuffer>[];
  expectedSigners: ExpectedSignerArgs[];
}) {
  const { domainConfig, verifyArgs, message, signature, publicKey } =
    extractSecp256r1VerificationArgs(creator);
  const instructions = [];
  if (message && signature && publicKey) {
    instructions.push(
      getSecp256r1VerifyInstruction([
        {
          message,
          signature,
          publicKey,
        },
      ]),
    );
  }

  instructions.push(
    getTransactionBufferCreateInstruction({
      settings,
      transactionBuffer: transactionBufferAddress,
      payer,
      secp256r1VerifyArgs: verifyArgs,
      creator: creator instanceof SignedSecp256r1Key ? undefined : creator,
      domainConfig,
      bufferIndex,
      finalBufferHash,
      finalBufferSize,
      bufferExtendHashes,
      preauthorizeExecution,
      expectedSigners,
      remainingAccounts: [],
    }),
  );

  return instructions;
}

import type { AccountMeta, Address, TransactionSigner } from "gill";
import {
  getTransactionBufferCreateCompressedInstruction,
  getTransactionBufferCreateInstruction,
  type ExpectedSecp256r1SignersArgs,
  type ProofArgsArgs,
  type SettingsReadonlyArgs,
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
  compressedArgs,
  expectedSecp256r1Signers,
}: {
  finalBufferHash: Uint8Array;
  finalBufferSize: number;
  payer: TransactionSigner;
  creator: TransactionSigner | SignedSecp256r1Key;
  settings: Address;
  bufferIndex: number;
  transactionBufferAddress: Address;
  preauthorizeExecution: boolean;
  bufferExtendHashes: Uint8Array[];
  compressedArgs: {
    settingsReadonlyArgs: SettingsReadonlyArgs;
    compressedProofArgs: ProofArgsArgs;
    remainingAccounts: AccountMeta[];
  } | null;
  expectedSecp256r1Signers: ExpectedSecp256r1SignersArgs[];
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
      ])
    );
  }

  if (compressedArgs) {
    const { settingsReadonlyArgs, compressedProofArgs, remainingAccounts } =
      compressedArgs;
    instructions.push(
      getTransactionBufferCreateCompressedInstruction({
        transactionBuffer: transactionBufferAddress,
        payer,
        secp256r1VerifyArgs: verifyArgs,
        creator: creator instanceof SignedSecp256r1Key ? undefined : creator,
        domainConfig,
        args: {
          bufferIndex,
          finalBufferHash,
          finalBufferSize,
          bufferExtendHashes,
          preauthorizeExecution,
          expectedSecp256r1Signers,
        },
        settingsReadonlyArgs,
        compressedProofArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionBufferCreateInstruction({
        settings,
        transactionBuffer: transactionBufferAddress,
        payer,
        secp256r1VerifyArgs: verifyArgs,
        creator: creator instanceof SignedSecp256r1Key ? undefined : creator,
        domainConfig,
        args: {
          bufferIndex,
          finalBufferHash,
          finalBufferSize,
          bufferExtendHashes,
          preauthorizeExecution,
          expectedSecp256r1Signers,
        },
        remainingAccounts: [],
      })
    );
  }

  return instructions;
}

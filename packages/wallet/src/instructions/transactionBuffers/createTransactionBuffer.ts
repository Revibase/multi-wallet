import type { AccountMeta, Address, TransactionSigner } from "gill";
import {
  getTransactionBufferCreateCompressedInstruction,
  getTransactionBufferCreateInstruction,
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
}) {
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    instructionsSysvar,
    message,
    signature,
    publicKey,
  } = extractSecp256r1VerificationArgs(creator);
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
    instructions.push(
      getTransactionBufferCreateCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
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
        },
        settingsReadonlyArgs: compressedArgs.settingsReadonlyArgs,
        compressedProofArgs: compressedArgs.compressedProofArgs,
        remainingAccounts: compressedArgs.remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionBufferCreateInstruction({
        instructionsSysvar,
        slotHashSysvar,
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
        },
        remainingAccounts: [],
      })
    );
  }

  return instructions;
}

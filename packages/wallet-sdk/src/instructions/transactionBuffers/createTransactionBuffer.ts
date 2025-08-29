import { AccountMeta, Address, TransactionSigner } from "@solana/kit";
import {
  getTransactionBufferCreateCompressedInstruction,
  getTransactionBufferCreateInstruction,
  ProofArgsArgs,
  SettingsReadonlyArgs,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/transactionMessage/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export function createTransactionBuffer({
  payer,
  creator,
  bufferIndex,
  settings,
  transactionBufferAddress,
  finalBufferHash,
  finalBufferSize,
  permissionlessExecution,
  bufferExtendHashes,
  compressedArgs,
}: {
  finalBufferHash: Uint8Array;
  finalBufferSize: number;
  payer: TransactionSigner;
  creator: TransactionSigner | Secp256r1Key;
  settings: Address;
  bufferIndex: number;
  transactionBufferAddress: Address;
  permissionlessExecution: boolean;
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
        creator: creator instanceof Secp256r1Key ? undefined : creator,
        domainConfig,
        args: {
          bufferIndex,
          finalBufferHash,
          finalBufferSize,
          bufferExtendHashes,
          permissionlessExecution,
        },
        settingsReadonly: compressedArgs.settingsReadonlyArgs,
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
        creator: creator instanceof Secp256r1Key ? undefined : creator,
        domainConfig,
        args: {
          bufferIndex,
          finalBufferHash,
          finalBufferSize,
          bufferExtendHashes,
          permissionlessExecution,
        },
      })
    );
  }

  return instructions;
}

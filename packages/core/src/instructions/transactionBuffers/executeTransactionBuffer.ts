import type { AccountMeta, Address, TransactionSigner } from "gill";
import {
  getTransactionBufferExecuteCompressedInstruction,
  getTransactionBufferExecuteInstruction,
  type ProofArgsArgs,
  type SettingsReadonlyArgs,
} from "../../generated";
import { SignedSecp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/transaction/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export function executeTransactionBuffer({
  executor,
  transactionBufferAddress,
  settings,
  compressedArgs,
}: {
  executor?: TransactionSigner | SignedSecp256r1Key;
  transactionBufferAddress: Address;
  settings: Address;
  compressedArgs: {
    settingsReadonlyArgs: SettingsReadonlyArgs;
    compressedProofArgs: ProofArgsArgs;
    remainingAccounts: AccountMeta[];
    payer: TransactionSigner;
  } | null;
}) {
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    signature,
    message,
    publicKey,
    instructionsSysvar,
  } = extractSecp256r1VerificationArgs(executor);
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
      getTransactionBufferExecuteCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        executor: executor instanceof SignedSecp256r1Key ? undefined : executor,
        settingsReadonlyArgs: compressedArgs.settingsReadonlyArgs,
        payer: compressedArgs.payer,
        compressedProofArgs: compressedArgs.compressedProofArgs,
        remainingAccounts: compressedArgs.remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionBufferExecuteInstruction({
        instructionsSysvar,
        slotHashSysvar,
        settings,
        transactionBuffer: transactionBufferAddress,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        executor: executor instanceof SignedSecp256r1Key ? undefined : executor,
        remainingAccounts: [],
      })
    );
  }

  return instructions;
}

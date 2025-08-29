import {
  AccountMeta,
  Address,
  Instruction,
  TransactionSigner,
} from "@solana/kit";
import {
  getTransactionBufferVoteCompressedInstruction,
  getTransactionBufferVoteInstruction,
  ProofArgsArgs,
  SettingsReadonlyArgs,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { extractSecp256r1VerificationArgs } from "../../utils/transactionMessage/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export function voteTransactionBuffer({
  settings,
  voter,
  transactionBufferAddress,
  compressedArgs,
}: {
  settings: Address;
  voter: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
  compressedArgs: {
    settingsReadonlyArgs: SettingsReadonlyArgs;
    compressedProofArgs: ProofArgsArgs;
    remainingAccounts: AccountMeta[];
    payer: TransactionSigner;
  } | null;
}) {
  const {
    instructionsSysvar,
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    signature,
    publicKey,
    message,
  } = extractSecp256r1VerificationArgs(voter);
  const instructions: Instruction[] = [];
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
      getTransactionBufferVoteCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        voter: voter instanceof Secp256r1Key ? undefined : voter,
        settingsReadonly: compressedArgs.settingsReadonlyArgs,
        payer: compressedArgs.payer,
        compressedProofArgs: compressedArgs.compressedProofArgs,
        remainingAccounts: compressedArgs.remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionBufferVoteInstruction({
        instructionsSysvar,
        slotHashSysvar,
        settings,
        transactionBuffer: transactionBufferAddress,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        voter: voter instanceof Secp256r1Key ? undefined : voter,
      })
    );
  }

  return instructions;
}

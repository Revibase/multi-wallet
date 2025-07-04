import { Address, TransactionSigner } from "@solana/kit";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import {
  getTransactionBufferExecuteCompressedInstruction,
  getTransactionBufferExecuteInstruction,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { getSettingsFromIndex } from "../../utils";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function executeTransactionBuffer({
  index,
  executor,
  transactionBufferAddress,
  compressed = false,
  payer,
}: {
  index: bigint | number;
  executor?: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
  compressed?: boolean;
  payer?: TransactionSigner;
}) {
  const settings = await getSettingsFromIndex(index);
  const {
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    signature,
    message,
    publicKey,
    instructionsSysvar,
  } = await extractSecp256r1VerificationArgs(executor);
  const packedAccounts = new PackedAccounts();
  const { settingsProofArgs, proof } = await constructSettingsProofArgs(
    packedAccounts,
    compressed,
    index
  );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
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

  if (compressed) {
    if (!payer || !settingsProofArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );

    instructions.push(
      getTransactionBufferExecuteCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        executor: executor instanceof Secp256r1Key ? undefined : executor,
        settingsArgs: settingsProofArgs,
        payer,
        compressedProofArgs,
        remainingAccounts,
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
        executor: executor instanceof Secp256r1Key ? undefined : executor,
      })
    );
  }

  return instructions;
}

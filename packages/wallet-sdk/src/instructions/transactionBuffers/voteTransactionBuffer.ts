import { Address, IInstruction, TransactionSigner } from "@solana/kit";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import {
  getTransactionBufferVoteCompressedInstruction,
  getTransactionBufferVoteInstruction,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { getSettingsFromIndex } from "../../utils";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function voteTransactionBuffer({
  index,
  voter,
  transactionBufferAddress,
  compressed = false,
  payer,
}: {
  index: bigint | number;
  voter: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
  compressed?: boolean;
  payer?: TransactionSigner;
}) {
  const {
    instructionsSysvar,
    slotHashSysvar,
    domainConfig,
    verifyArgs,
    signature,
    publicKey,
    message,
  } = await extractSecp256r1VerificationArgs(voter);
  const settings = await getSettingsFromIndex(index);
  const packedAccounts = new PackedAccounts();
  const { settingsProofArgs, proof } = await constructSettingsProofArgs(
    packedAccounts,
    compressed,
    index
  );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
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

  if (compressed) {
    if (!payer || !settingsProofArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );

    instructions.push(
      getTransactionBufferVoteCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        secp256r1VerifyArgs: verifyArgs,
        domainConfig,
        voter: voter instanceof Secp256r1Key ? undefined : voter,
        settingsArgs: settingsProofArgs,
        payer,
        compressedProofArgs,
        remainingAccounts,
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

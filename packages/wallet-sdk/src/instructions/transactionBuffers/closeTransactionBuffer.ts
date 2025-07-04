import { Address, TransactionSigner } from "@solana/kit";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import {
  fetchTransactionBuffer,
  getTransactionBufferCloseCompressedInstruction,
  getTransactionBufferCloseInstruction,
} from "../../generated";
import { Secp256r1Key } from "../../types";
import { getSettingsFromIndex, getSolanaRpc } from "../../utils";
import { extractSecp256r1VerificationArgs } from "../../utils/internal";
import { getSecp256r1VerifyInstruction } from "../secp256r1Verify";

export async function closeTransactionBuffer({
  index,
  closer,
  transactionBufferAddress,
  payer,
  compressed = false,
}: {
  index: bigint | number;
  closer: TransactionSigner | Secp256r1Key;
  transactionBufferAddress: Address;
  payer?: TransactionSigner;
  compressed?: boolean;
}) {
  const transactionBuffer = await fetchTransactionBuffer(
    getSolanaRpc(),
    transactionBufferAddress
  );
  const settings = await getSettingsFromIndex(index);
  const packedAccounts = new PackedAccounts();
  const { settingsProofArgs, proof } = await constructSettingsProofArgs(
    packedAccounts,
    compressed,
    index
  );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();
  const {
    slotHashSysvar,
    instructionsSysvar,
    domainConfig,
    verifyArgs,
    message,
    signature,
    publicKey,
  } = await extractSecp256r1VerificationArgs(closer);

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
      getTransactionBufferCloseCompressedInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        domainConfig,
        closer: closer instanceof Secp256r1Key ? undefined : closer,
        rentCollector: transactionBuffer.data.payer,
        secp256r1VerifyArgs: verifyArgs,
        settingsArgs: settingsProofArgs,
        payer,
        compressedProofArgs,
        remainingAccounts,
      })
    );
  } else {
    instructions.push(
      getTransactionBufferCloseInstruction({
        instructionsSysvar,
        slotHashSysvar,
        transactionBuffer: transactionBufferAddress,
        domainConfig,
        closer: closer instanceof Secp256r1Key ? undefined : closer,
        settings,
        payer: transactionBuffer.data.payer,
        secp256r1VerifyArgs: verifyArgs,
      })
    );
  }

  return instructions;
}

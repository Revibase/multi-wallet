import { Address, TransactionSigner } from "@solana/kit";
import {
  constructSettingsProofArgs,
  convertToCompressedProofArgs,
} from "../../compressed/internal";
import { PackedAccounts } from "../../compressed/packedAccounts";
import {
  getTransactionBufferExtendCompressedInstruction,
  getTransactionBufferExtendInstruction,
} from "../../generated";
import { getSettingsFromIndex } from "../../utils";

export async function extendTransactionBuffer({
  transactionMessageBytes,
  transactionBufferAddress,
  index,
  compressed = false,
  payer,
}: {
  transactionMessageBytes: Uint8Array;
  transactionBufferAddress: Address;
  index: bigint | number;
  compressed?: boolean;
  payer?: TransactionSigner;
}) {
  const settings = await getSettingsFromIndex(index);
  const packedAccounts = new PackedAccounts();
  const { settingsProofArgs, proof } = await constructSettingsProofArgs(
    packedAccounts,
    compressed,
    index
  );
  const { remainingAccounts, systemOffset } = packedAccounts.toAccountMetas();

  if (compressed) {
    if (!payer || !settingsProofArgs) {
      throw new Error("Payer not found or proof args is missing.");
    }
    const compressedProofArgs = convertToCompressedProofArgs(
      proof,
      systemOffset
    );

    return getTransactionBufferExtendCompressedInstruction({
      transactionBuffer: transactionBufferAddress,
      buffer: transactionMessageBytes,
      settingsArgs: settingsProofArgs,
      payer,
      compressedProofArgs,
      remainingAccounts,
    });
  } else {
    return getTransactionBufferExtendInstruction({
      transactionBuffer: transactionBufferAddress,
      buffer: transactionMessageBytes,
      settings,
    });
  }
}

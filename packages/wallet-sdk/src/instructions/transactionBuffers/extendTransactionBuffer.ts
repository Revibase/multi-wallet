import { Address } from "@solana/kit";
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
}: {
  transactionMessageBytes: Uint8Array;
  transactionBufferAddress: Address;
  index: bigint | number;
  compressed?: boolean;
}) {
  const settings = await getSettingsFromIndex(index);
  const packedAccounts = new PackedAccounts();

  const { remainingAccounts } = packedAccounts.toAccountMetas();

  if (compressed) {
    return getTransactionBufferExtendCompressedInstruction({
      transactionBuffer: transactionBufferAddress,
      buffer: transactionMessageBytes,
      settingsKey: settings,
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

import { Address } from "@solana/kit";
import {
  getTransactionBufferExtendCompressedInstruction,
  getTransactionBufferExtendInstruction,
} from "../../generated";

export function extendTransactionBuffer({
  transactionMessageBytes,
  transactionBufferAddress,
  settings,
  compressed = false,
}: {
  transactionMessageBytes: Uint8Array;
  transactionBufferAddress: Address;
  settings: Address;
  compressed?: boolean;
}) {
  if (compressed) {
    return getTransactionBufferExtendCompressedInstruction({
      transactionBuffer: transactionBufferAddress,
      buffer: transactionMessageBytes,
      settingsKey: settings,
    });
  } else {
    return getTransactionBufferExtendInstruction({
      transactionBuffer: transactionBufferAddress,
      buffer: transactionMessageBytes,
      settings,
    });
  }
}

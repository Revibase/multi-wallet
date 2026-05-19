import type { Address } from "gill";
import { getTransactionBufferExtendInstruction } from "../../generated";

export function extendTransactionBuffer({
  transactionMessageBytes,
  transactionBufferAddress,
  settings,
}: {
  transactionMessageBytes: Uint8Array<ArrayBuffer>;
  transactionBufferAddress: Address;
  settings: Address;
}) {
  return getTransactionBufferExtendInstruction({
    transactionBuffer: transactionBufferAddress,
    buffer: transactionMessageBytes,
    settings,
    remainingAccounts: [],
  });
}

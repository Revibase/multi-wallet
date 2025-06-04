import { Address } from "@solana/kit";
import { getTransactionBufferExtendInstruction } from "../../generated";

export function extendTransactionBuffer({
  transactionMessageBytes,
  transactionBufferAddress,
  settings,
}: {
  transactionMessageBytes: Uint8Array;
  transactionBufferAddress: Address;
  settings: Address;
}) {
  return getTransactionBufferExtendInstruction({
    transactionBuffer: transactionBufferAddress,
    buffer: transactionMessageBytes,
    settings,
  });
}

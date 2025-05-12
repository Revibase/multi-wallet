import { Address } from "@solana/kit";
import { getTransactionBufferExtendInstruction } from "../../generated";

export function extendTransactionBuffer({
  transactionMessageBytes,
  transactionBufferAddress,
}: {
  transactionMessageBytes: Uint8Array;
  transactionBufferAddress: Address;
}) {
  return getTransactionBufferExtendInstruction({
    transactionBuffer: transactionBufferAddress,
    buffer: transactionMessageBytes,
  });
}

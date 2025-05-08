import { address } from "@solana/kit";
import { getTransactionBufferExtendInstruction } from "../../generated";

export function extendTransactionBuffer({
  transactionMessageBytes,
  transactionBufferAddress,
}: {
  transactionMessageBytes: Uint8Array;
  transactionBufferAddress: string;
}) {
  return getTransactionBufferExtendInstruction({
    transactionBuffer: address(transactionBufferAddress),
    buffer: transactionMessageBytes,
  });
}

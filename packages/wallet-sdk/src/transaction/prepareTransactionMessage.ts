import {
  Address,
  AddressesByLookupTableAddress,
  Instruction,
} from "@solana/kit";
import { customTransactionMessageSerialize } from "../utils";
import { compileToWrappedMessageV0 } from "../utils/transactionMessage/compileToWrappedMessageV0";

export function prepareTransactionMessage(
  recentBlockhash: string,
  payer: Address,
  instructions: Instruction[],
  addressesByLookupTableAddress?: AddressesByLookupTableAddress
) {
  const compiledMessage = compileToWrappedMessageV0({
    payer,
    recentBlockhash,
    instructions,
    addressesByLookupTableAddress,
  });

  const transactionMessageBytes = new Uint8Array(
    customTransactionMessageSerialize(compiledMessage)
  );

  return transactionMessageBytes;
}

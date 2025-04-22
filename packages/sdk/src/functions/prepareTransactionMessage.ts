import {
  Address,
  AddressesByLookupTableAddress,
  IInstruction,
} from "@solana/kit";
import { compileToWrappedMessageV0 } from "../utils/compileToWrappedMessageV0";
import { customTransactionMessageSerialize } from "../utils/customTransactionMessage";

export async function prepareTransactionMessage(
  recentBlockhash: string,
  feePayer: Address,
  instructions: IInstruction[],
  addressesByLookupTableAddress?: AddressesByLookupTableAddress
) {
  const compiledMessage = compileToWrappedMessageV0({
    payerKey: feePayer.toString(),
    recentBlockhash,
    instructions,
    addressesByLookupTableAddress,
  });

  const transactionMessageBytes = new Uint8Array(
    customTransactionMessageSerialize(compiledMessage)
  );

  return transactionMessageBytes;
}

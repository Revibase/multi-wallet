import {
  Address,
  AddressesByLookupTableAddress,
  IInstruction,
} from "@solana/kit";
import { customTransactionMessageSerialize } from "../utils";
import { compileToWrappedMessageV0 } from "../utils/transactionMessage/compileToWrappedMessageV0";

export async function prepareTransactionMessage(
  recentBlockhash: string,
  feePayer: Address,
  instructions: IInstruction[],
  addressesByLookupTableAddress?: AddressesByLookupTableAddress
) {
  const compiledMessage = compileToWrappedMessageV0({
    payerKey: feePayer,
    recentBlockhash,
    instructions,
    addressesByLookupTableAddress,
  });

  const transactionMessageBytes = new Uint8Array(
    customTransactionMessageSerialize(compiledMessage)
  );

  return transactionMessageBytes;
}

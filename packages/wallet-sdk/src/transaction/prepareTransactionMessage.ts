import type { Address, AddressesByLookupTableAddress, Instruction } from "gill";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../generated";
import { customTransactionMessageSerialize } from "../utils";
import { compileToWrappedMessageV0 } from "../utils/transactionMessage/compileToWrappedMessageV0";
interface PrepareTransactionMessageArgs {
  instructions: Instruction[];
  payer: Address;
  recentBlockhash?: string;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
}
export function prepareTransactionMessage({
  instructions,
  payer,
  recentBlockhash = MULTI_WALLET_PROGRAM_ADDRESS.toString(),
  addressesByLookupTableAddress,
}: PrepareTransactionMessageArgs) {
  const compiledMessage = compileToWrappedMessageV0({
    instructions,
    payer,
    recentBlockhash,
    addressesByLookupTableAddress,
  });

  const transactionMessageBytes = new Uint8Array(
    customTransactionMessageSerialize(compiledMessage)
  );

  return transactionMessageBytes;
}

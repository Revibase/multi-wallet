import {
  type Address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import { MULTI_WALLET_PROGRAM_ADDRESS } from "../generated";
import { vaultTransactionMessageSerialize } from "../types";
import { compileToWrappedMessageV0 } from "../utils/transactionMessage/compileToWrappedMessageV0";
interface PrepareTransactionMessageArgs {
  instructions: Instruction[];
  payer: Address;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
}
export function prepareTransactionMessage({
  instructions,
  payer,
  addressesByLookupTableAddress,
}: PrepareTransactionMessageArgs) {
  const compiledMessage = compileToWrappedMessageV0({
    instructions,
    payer,
    recentBlockhash: MULTI_WALLET_PROGRAM_ADDRESS,
    addressesByLookupTableAddress,
  });

  return new Uint8Array(vaultTransactionMessageSerialize(compiledMessage));
}

import {
  compileTransactionMessage,
  createNoopSigner,
  type Address,
  type Instruction,
} from "@solana/kit";
import { vaultTransactionMessageSerialize } from "../types";
interface PrepareTransactionMessageArgs {
  instructions: Instruction[];
  payer: Address;
}
export function prepareTransactionMessage({
  instructions,
  payer,
}: PrepareTransactionMessageArgs) {
  const compiledMessage = compileTransactionMessage({
    instructions,
    feePayer: createNoopSigner(payer),
    version: 1,
  });

  return new Uint8Array(vaultTransactionMessageSerialize(compiledMessage));
}

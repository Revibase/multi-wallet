import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import { transactionMessageBeet } from "../types";
import {
  transactionMessageSerialize,
  transactionMessageToCompileMessage,
} from "../utils";

export function prepareTransactionMessage(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  lookUpTables?: AddressLookupTableAccount[]
) {
  const transactionMessageTx = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: PublicKey.default.toString(),
    instructions,
  });

  const compiledMessage = transactionMessageToCompileMessage({
    message: transactionMessageTx,
    addressLookupTableAccounts: lookUpTables,
  });

  const transactionMessageBytes = transactionMessageSerialize(compiledMessage);
  const transactionMessage = transactionMessageBeet.deserialize(
    transactionMessageBytes
  )[0];
  return { compiledMessage, transactionMessageBytes, transactionMessage };
}

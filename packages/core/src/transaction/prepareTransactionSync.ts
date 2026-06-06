import type {
  Address,
  ReadonlyUint8Array,
  TransactionSigner,
} from "@solana/kit";
import {
  executeTransactionSync,
  type Secp256r1VerifyInput,
} from "../instructions";
import { SignedSecp256r1Key, type TransactionDetails } from "../types";

interface CreateTransactionSyncArgs {
  payer: TransactionSigner;
  settings: Address;
  transactionMessageBytes: ReadonlyUint8Array;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  additionalSigners?: TransactionSigner[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
}

export async function prepareTransactionSync({
  payer,
  settings,
  transactionMessageBytes,
  signers,
  additionalSigners,
  secp256r1VerifyInput,
}: CreateTransactionSyncArgs): Promise<TransactionDetails> {
  const { instructions } = await executeTransactionSync({
    settings,
    signers,
    additionalSigners,
    transactionMessageBytes,
    secp256r1VerifyInput,
  });

  return {
    payer,
    instructions,
  };
}

import type {
  AddressesByLookupTableAddress,
  ReadonlyUint8Array,
  TransactionSigner,
} from "gill";
import {
  executeTransactionSync,
  type Secp256r1VerifyInput,
} from "../instructions";
import { Secp256r1Key, type TransactionDetails } from "../types";

interface CreateTransactionSyncArgs {
  payer: TransactionSigner;
  index: number | bigint;
  transactionMessageBytes: ReadonlyUint8Array;
  signers: (TransactionSigner | Secp256r1Key)[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
  simulateProof?: boolean;
  cachedAccounts?: Map<string, any>;
}

export async function prepareTransactionSync({
  payer,
  index,
  transactionMessageBytes,
  signers,
  secp256r1VerifyInput,
  addressesByLookupTableAddress,
  cachedAccounts,
  compressed = false,
  simulateProof = false,
}: CreateTransactionSyncArgs): Promise<TransactionDetails> {
  const { instructions, addressLookupTableAccounts } =
    await executeTransactionSync({
      index,
      payer,
      signers,
      transactionMessageBytes,
      secp256r1VerifyInput,
      compressed,
      addressesByLookupTableAddress,
      simulateProof,
      cachedAccounts,
    });

  return {
    payer,
    instructions,
    addressesByLookupTableAddress: addressLookupTableAccounts,
  };
}

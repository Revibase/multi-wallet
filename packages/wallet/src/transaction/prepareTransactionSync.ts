import type {
  AddressesByLookupTableAddress,
  ReadonlyUint8Array,
  TransactionSigner,
} from "gill";
import {
  executeTransactionSync,
  type Secp256r1VerifyInput,
} from "../instructions";
import { type BundleResponse, Secp256r1Key } from "../types";

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
}: CreateTransactionSyncArgs): Promise<BundleResponse> {
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
    id: "Execute Transaction Sync",
    payer,
    ixs: instructions,
    addressLookupTableAccounts,
  };
}

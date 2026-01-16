import type {
  AddressesByLookupTableAddress,
  ReadonlyUint8Array,
  TransactionSigner,
} from "gill";
import {
  executeTransactionSync,
  type Secp256r1VerifyInput,
} from "../instructions";
import type { AccountCache } from "../types";
import { SignedSecp256r1Key, type TransactionDetails } from "../types";

interface CreateTransactionSyncArgs {
  payer: TransactionSigner;
  index: number | bigint;
  settingsAddressTreeIndex?: number;
  transactionMessageBytes: ReadonlyUint8Array;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
  simulateProof?: boolean;
  cachedAccounts?: AccountCache;
}

export async function prepareTransactionSync({
  payer,
  index,
  settingsAddressTreeIndex,
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
      settingsAddressTreeIndex,
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

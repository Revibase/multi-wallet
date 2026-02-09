import type {
  Address,
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
  settings: Address;
  settingsAddressTreeIndex?: number;
  transactionMessageBytes: ReadonlyUint8Array;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  additionalSigners?: TransactionSigner[];
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
  simulateProof?: boolean;
  cachedAccounts?: AccountCache;
}

export async function prepareTransactionSync({
  payer,
  settings,
  settingsAddressTreeIndex,
  transactionMessageBytes,
  signers,
  additionalSigners,
  secp256r1VerifyInput,
  addressesByLookupTableAddress,
  cachedAccounts,
  compressed = false,
  simulateProof = false,
}: CreateTransactionSyncArgs): Promise<TransactionDetails> {
  const { instructions, addressLookupTableAccounts } =
    await executeTransactionSync({
      settings,
      settingsAddressTreeIndex,
      payer,
      signers,
      additionalSigners,
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

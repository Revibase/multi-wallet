import type {
  Address,
  AddressesByLookupTableAddress,
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
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  secp256r1VerifyInput?: Secp256r1VerifyInput;
}

export async function prepareTransactionSync({
  payer,
  settings,
  transactionMessageBytes,
  signers,
  additionalSigners,
  secp256r1VerifyInput,
  addressesByLookupTableAddress,
}: CreateTransactionSyncArgs): Promise<TransactionDetails> {
  const { instructions, addressLookupTableAccounts } =
    await executeTransactionSync({
      settings,
      signers,
      additionalSigners,
      transactionMessageBytes,
      secp256r1VerifyInput,
      addressesByLookupTableAddress,
    });

  return {
    payer,
    instructions,
    addressesByLookupTableAddress: addressLookupTableAccounts,
  };
}

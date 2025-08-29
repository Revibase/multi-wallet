import { TransactionSigner } from "@solana/kit";
import { executeTransactionSync, Secp256r1VerifyInput } from "../instructions";
import { Secp256r1Key } from "../types";

interface CreateTransactionSyncArgs {
  payer: TransactionSigner;
  index: number | bigint;
  transactionMessageBytes: Uint8Array;
  signers: (TransactionSigner | Secp256r1Key)[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  compressed?: boolean;
}

export async function prepareTransactionSync({
  payer,
  index,
  transactionMessageBytes,
  signers,
  secp256r1VerifyInput,
  compressed = false,
}: CreateTransactionSyncArgs) {
  const { instructions, addressLookupTableAccounts } =
    await executeTransactionSync({
      index,
      payer,
      signers,
      transactionMessageBytes,
      secp256r1VerifyInput,
      compressed,
    });

  return {
    id: "Execute Transaction Sync",
    payer,
    ixs: instructions,
    addressLookupTableAccounts,
  };
}

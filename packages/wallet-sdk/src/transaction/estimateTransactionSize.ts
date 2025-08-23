import {
  TransactionSigner,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { pipe } from "codama";
import { Secp256r1Key } from "../types";
import { prepareTransactionSync } from "./prepareTransactionSync";

export async function estimateTransactionSize({
  payer,
  settingsIndex,
  transactionMessageBytes,
  additionalSigners,
  compressed,
}: {
  payer: TransactionSigner;
  settingsIndex: number;
  compressed: boolean;
  transactionMessageBytes: Uint8Array;
  additionalSigners: TransactionSigner[];
}) {
  const randomPubkey = crypto.getRandomValues(new Uint8Array(33));
  const signer = new Secp256r1Key(randomPubkey, {
    authData: crypto.getRandomValues(new Uint8Array(37)),
    domainConfig: getAddressDecoder().decode(
      crypto.getRandomValues(new Uint8Array(32))
    ),
    signature: crypto.getRandomValues(new Uint8Array(64)),
    verifyArgs: {
      slotHash: crypto.getRandomValues(new Uint8Array(32)),
      slotNumber: BigInt(0),
      clientDataJson: crypto.getRandomValues(new Uint8Array(150)),
    },
  });
  const result = await prepareTransactionSync({
    payer,
    index: settingsIndex,
    transactionMessageBytes,
    signers: [signer, ...(additionalSigners ?? [])],
    compressed,
    skipChecks: true,
  });

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(result.ixs, tx),
    (tx) => setTransactionMessageFeePayerSigner(result.payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: getBlockhashDecoder().decode(
            crypto.getRandomValues(new Uint8Array(32))
          ),
          lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
        },
        tx
      ),
    (tx) =>
      result.addressLookupTableAccounts
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            result.addressLookupTableAccounts
          )
        : tx,
    (tx) => compileTransaction(tx)
  );
  const txSize = getBase64EncodedWireTransaction(tx).length;

  return txSize;
}

/**
 * Transaction signing utilities
 */

import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import { COMPUTE_UNIT_MULTIPLIER, MIN_COMPUTE_UNITS } from "../../constants";
import type { TransactionDetails } from "../../types";
import {
  getComputeBudgetEstimate,
  getSendAndConfirmTransaction,
  getSolanaRpc,
} from "../initialize";
import { getMedianPriorityFees } from "../transaction/internal";

/**
 * Signs and sends a transaction with automatic compute unit and priority fee estimation
 * By default, median priority fees are added to the transaction
 * @param details - Transaction details including instructions, payer, and optional lookup tables
 * @returns Transaction signature
 * @throws {TransactionError} If transaction fails
 */
export async function signAndSendTransaction({
  instructions,
  payer,
  addressesByLookupTableAddress,
}: TransactionDetails): Promise<string> {
  const latestBlockHash = await getSolanaRpc().getLatestBlockhash().send();
  const tx = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockHash.value, tx),
    (tx) =>
      addressesByLookupTableAddress
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            addressesByLookupTableAddress,
          )
        : tx,
    async (tx) => {
      const [estimatedUnits, priorityFees] = await Promise.all([
        getComputeBudgetEstimate()(tx),
        getMedianPriorityFees(
          getSolanaRpc(),
          tx.instructions.flatMap((x) => x.accounts ?? []),
        ),
      ]);
      const computeUnits = Math.ceil(estimatedUnits * COMPUTE_UNIT_MULTIPLIER);
      return prependTransactionMessageInstructions(
        [
          ...(computeUnits > MIN_COMPUTE_UNITS
            ? [
                getSetComputeUnitLimitInstruction({
                  units: computeUnits,
                }),
              ]
            : []),
          ...(priorityFees > 0
            ? [
                getSetComputeUnitPriceInstruction({
                  microLamports: priorityFees,
                }),
              ]
            : []),
        ],
        tx,
      );
    },
    async (tx) => await signTransactionMessageWithSigners(await tx),
  );
  await getSendAndConfirmTransaction()(tx, {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return getSignatureFromTransaction(tx);
}

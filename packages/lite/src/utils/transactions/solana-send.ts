import { getSolanaRpc, type TransactionDetails } from "@revibase/core";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type AccountMeta,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import type { RevibaseProvider } from "../../provider";
import { withRetry } from "../retry";

export async function signAndSendTransaction({
  instructions,
  payer,
  addressesByLookupTableAddress,
  unitsConsumed,
}: TransactionDetails): Promise<string> {
  const latestBlockHash = await withRetry(() =>
    getSolanaRpc().getLatestBlockhash().send(),
  );
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
      const priorityFees = await getMedianPriorityFees(
        getSolanaRpc(),
        tx.instructions.flatMap((x) => x.accounts ?? []),
      );

      const computeUnits = Math.ceil((Number(unitsConsumed) ?? 0) * 1.1);
      return prependTransactionMessageInstructions(
        [
          ...(computeUnits > 200_000
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
    async (tx) =>
      await withRetry(async () => signTransactionMessageWithSigners(await tx)),
  );
  await withRetry(() =>
    getSolanaRpc()
      .sendTransaction(getBase64EncodedWireTransaction(tx), {
        skipPreflight: true,
        encoding: "base64",
      })
      .send(),
  );

  return getSignatureFromTransaction(tx);
}

export async function signAndSendBundledTransactions(
  provider: RevibaseProvider,
  bundle: TransactionDetails[],
): Promise<string> {
  const encodedBundle = await createEncodedBundle(bundle);
  await withRetry(() =>
    provider.onSendJitoBundleCallback(
      encodedBundle.map(getBase64EncodedWireTransaction),
    ),
  );
  return getSignatureFromTransaction(encodedBundle[encodedBundle.length - 1]);
}

async function createEncodedBundle(bundle: TransactionDetails[]) {
  const latestBlockHash = (
    await withRetry(() => getSolanaRpc().getLatestBlockhash().send())
  ).value;
  return await Promise.all(
    bundle.map(async (x) => {
      const tx = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => appendTransactionMessageInstructions(x.instructions, tx),
        (tx) => setTransactionMessageFeePayerSigner(x.payer, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockHash, tx),
        (tx) =>
          x.addressesByLookupTableAddress
            ? compressTransactionMessageUsingAddressLookupTables(
                tx,
                x.addressesByLookupTableAddress,
              )
            : tx,
        (tx) => {
          const computeUnits = Math.ceil(Number(x.unitsConsumed ?? 0) * 1.1);
          return computeUnits > 200_000
            ? prependTransactionMessageInstructions(
                [
                  getSetComputeUnitLimitInstruction({
                    units: computeUnits,
                  }),
                ],
                tx,
              )
            : tx;
        },
        async (tx) =>
          await withRetry(() => signTransactionMessageWithSigners(tx)),
      );
      return tx;
    }),
  );
}

export async function getMedianPriorityFees(
  connection: Rpc<SolanaRpcApi>,
  accounts: AccountMeta[],
): Promise<number> {
  const recentFees = await withRetry(() =>
    connection
      .getRecentPrioritizationFees(
        accounts
          .filter(
            (x) =>
              x.role === AccountRole.WRITABLE ||
              x.role === AccountRole.WRITABLE_SIGNER,
          )
          .map((x) => x.address),
      )
      .send(),
  );
  const fees = recentFees.map((f) => Number(f.prioritizationFee));
  fees.sort((a, b) => a - b);
  const mid = Math.floor(fees.length / 2);

  if (fees.length % 2 === 0) {
    return Math.round((fees[mid - 1] + fees[mid]) / 2);
  } else {
    return fees[mid];
  }
}

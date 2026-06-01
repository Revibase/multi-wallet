import {
  getSolanaRpc,
  getSolanaRpcEndpoint,
  type TransactionDetails,
} from "@revibase/core";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
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

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const e = new Error("Aborted");
  e.name = "AbortError";
  throw e;
}

export async function signAndSendTransaction(
  details: TransactionDetails,
  signal?: AbortSignal,
): Promise<string> {
  const { instructions, payer, addressesByLookupTableAddress } = details;
  throwIfAborted(signal);
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
      const [unitsConsumed, priorityFees] = await Promise.all([
        getComputeUnitsEstimate(tx),
        getMedianPriorityFees(
          getSolanaRpc(),
          tx.instructions.flatMap((x) => x.accounts ?? []),
        ),
      ]);
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
      await withRetry(async () =>
        signTransactionMessageWithSigners(await tx, { abortSignal: signal }),
      ),
  );
  throwIfAborted(signal);
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
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const simulationBundle = await createEncodedBundle(bundle, true, signal);
  throwIfAborted(signal);
  const computeUnits = await simulateBundle(
    simulationBundle.map(getBase64EncodedWireTransaction),
    getSolanaRpcEndpoint(),
  );
  throwIfAborted(signal);
  const encodedBundle = await createEncodedBundle(
    bundle.map((x, index) => ({
      ...x,
      unitsConsumed: computeUnits[index],
    })),
    false,
    signal,
  );
  throwIfAborted(signal);
  await withRetry(() =>
    provider.onSendJitoBundleCallback(
      encodedBundle.map(getBase64EncodedWireTransaction),
    ),
  );
  return getSignatureFromTransaction(encodedBundle[encodedBundle.length - 1]);
}

export async function simulateBundle(
  bundle: string[],
  connectionUrl: string,
): Promise<number[]> {
  const response = await withRetry(() =>
    fetch(connectionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "simulateBundle",
        params: [
          {
            encodedTransactions: bundle,
          },
          {
            skipSigVerify: true,
            replaceRecentBlockhash: true,
            preExecutionAccountsConfigs: bundle.map(() => ({
              encoding: "base64",
              addresses: [],
            })),
            postExecutionAccountsConfigs: bundle.map(() => ({
              encoding: "base64",
              addresses: [],
            })),
          },
        ],
      }),
    }),
  );

  const data = (await response.json()) as {
    result?: {
      value: {
        transactionResults: { unitsConsumed: number }[];
        summary:
          | string
          | {
              failed?: {
                error: {
                  TransactionFailure: [unknown, string];
                };
              };
            };
      };
    };
    error?: unknown;
  };

  if (!data.result || data.error) {
    throw new Error(
      `Unable to simulate bundle: ${JSON.stringify(data.error ?? data.result)}`,
    );
  }

  if (
    typeof data.result.value.summary !== "string" &&
    data.result.value.summary.failed
  ) {
    const { TransactionFailure } = data.result.value.summary.failed.error;
    const [, programError] = TransactionFailure;
    throw new Error(`Simulation failed: ${programError}`);
  }

  return data.result.value.transactionResults.map((x) => x.unitsConsumed);
}

async function createEncodedBundle(
  bundle: (TransactionDetails & { unitsConsumed?: number })[],
  isSimulate = false,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const latestBlockHash = isSimulate
    ? {
        blockhash: getBlockhashDecoder().decode(
          crypto.getRandomValues(new Uint8Array(32)),
        ),
        lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
      }
    : (await withRetry(() => getSolanaRpc().getLatestBlockhash().send())).value;
  return await Promise.all(
    bundle.map(async (x) => {
      throwIfAborted(signal);
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
          const computeUnits = Math.ceil((x.unitsConsumed ?? 0) * 1.1);
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
          isSimulate
            ? compileTransaction(tx)
            : await withRetry(() =>
                signTransactionMessageWithSigners(tx, { abortSignal: signal }),
              ),
      );
      return tx;
    }),
  );
}

async function getComputeUnitsEstimate(
  transactionMessage: Parameters<typeof compileTransaction>[0],
) {
  const transactionMessageWithComputeUnitAndPriorityFees =
    prependTransactionMessageInstructions(
      [
        getSetComputeUnitLimitInstruction({ units: 800_000 }),
        getSetComputeUnitPriceInstruction({ microLamports: 10_000 }),
      ],
      transactionMessage,
    );
  const transaction = compileTransaction(
    transactionMessageWithComputeUnitAndPriorityFees,
  );
  const simulatedTransaction = await withRetry(() =>
    getSolanaRpc()
      .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: "base64",
      })
      .send(),
  );
  if (simulatedTransaction.value.err) {
    if (simulatedTransaction.value.logs) {
      const errorMessage = [
        "Transaction simulation failed:",
        "",
        ...simulatedTransaction.value.logs,
      ].join("\n");
      throw new Error(errorMessage);
    }
    const errorMessage = [
      "Transaction simulation failed:",
      "",
      simulatedTransaction.value.err.toString(),
    ].join("\n");
    throw new Error(errorMessage);
  }
  return simulatedTransaction.value.unitsConsumed;
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

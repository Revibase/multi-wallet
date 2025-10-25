import {
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
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import type { TransactionDetails } from "../../types";
import {
  getComputeBudgetEstimate,
  getJitoTipsConfig,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  getSolanaRpcEndpoint,
} from "../initialize";
import {
  createEncodedBundle,
  getMedianPriorityFees,
  simulateBundle,
} from "./internal";

export async function sendBundleTransactions(bundle: TransactionDetails[]) {
  const simulationBundle = await createEncodedBundle(bundle, true);
  const computeUnits = await simulateBundle(
    simulationBundle.map(getBase64EncodedWireTransaction),
    getSolanaRpcEndpoint()
  );
  const encodedBundle = await createEncodedBundle(
    bundle.map((x, index) => ({
      ...x,
      unitsConsumed: computeUnits[index],
    }))
  );
  const bundleId = await sendJitoBundle(
    encodedBundle.map(getBase64EncodedWireTransaction)
  );

  const signature = await pollJitoBundleConfirmation(bundleId);

  return signature;
}

export async function sendTransaction({
  instructions,
  payer,
  addressesByLookupTableAddress,
}: TransactionDetails) {
  const latestBlockHash = await getSolanaRpc().getLatestBlockhash().send();
  const tx = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions([...instructions], tx),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockHash.value, tx),
    (tx) =>
      addressesByLookupTableAddress
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            addressesByLookupTableAddress
          )
        : tx,
    async (tx) => {
      const [estimatedUnits, priorityFees] = await Promise.all([
        getComputeBudgetEstimate()(tx),
        getMedianPriorityFees(
          getSolanaRpc(),
          tx.instructions.flatMap((x) => x.accounts ?? [])
        ),
      ]);
      const computeUnits = Math.ceil(estimatedUnits * 1.1);
      return prependTransactionMessageInstructions(
        [
          ...(computeUnits > 200000
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
        tx
      );
    },
    async (tx) => await signTransactionMessageWithSigners(await tx)
  );
  await getSendAndConfirmTransaction()(tx, {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return getSignatureFromTransaction(tx);
}

export async function sendJitoBundle(
  serializedTransactions: string[],
  maxRetries = 10,
  delayMs = 1000,
  jitoTipsConfig = getJitoTipsConfig()
): Promise<string> {
  const { jitoBlockEngineUrl } = jitoTipsConfig;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${jitoBlockEngineUrl}/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [
          serializedTransactions,
          {
            encoding: "base64",
          },
        ],
      }),
    });

    if (response.status === 429) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `Error sending bundles: ${JSON.stringify(data.error, null, 2)}`
      );
    }

    return data.result as string;
  }

  throw new Error("Failed to send bundle after retries.");
}
export async function pollJitoBundleConfirmation(
  bundleId: string,
  maxRetries = 30,
  delayMs = 3000,
  jitoTipsConfig = getJitoTipsConfig()
): Promise<string> {
  const { jitoBlockEngineUrl } = jitoTipsConfig;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${jitoBlockEngineUrl}/getBundleStatuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBundleStatuses",
        params: [[bundleId]],
      }),
    });

    if (response.status === 429) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `Error sending bundles: ${JSON.stringify(data.error, null, 2)}`
      );
    }

    const results = data.result as {
      context: {
        slot: number;
      };
      value: {
        bundle_id: string;
        transactions: string[];
        slot: number;
        confirmation_status: "processed" | "confirmed" | "finalized";
        err: {
          Ok: null;
        };
      }[];
    };

    if (results.value.length) {
      const value = results.value[0];
      if (
        value.confirmation_status === "confirmed" ||
        value.confirmation_status === "finalized"
      ) {
        return value.transactions[value.transactions.length - 1];
      }
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
  }

  throw new Error("Failed to get bundle status after retries.");
}

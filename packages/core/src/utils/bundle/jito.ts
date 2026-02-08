import { getBase64EncodedWireTransaction } from "gill";
import { BUNDLE_POLL_DELAY_MS, BUNDLE_POLL_MAX_RETRIES } from "../../constants";
import { BundleError, NetworkError } from "../../errors";
import type { TransactionDetails } from "../../types";
import { parseJson, validateResponse } from "../async";
import { getJitoTipsConfig, getSolanaRpcEndpoint } from "../initialize";
import {
  createShouldRetryForErrors,
  retryFetch,
  retryWithBackoff,
  type RetryConfig,
} from "../retry";
import { createEncodedBundle, simulateBundle } from "../transaction/internal";
import { requireNonEmpty, requireNonEmptyString } from "../validation";

interface BundleStatusResponse {
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
}

export async function signAndSendBundledTransactions(
  bundle: TransactionDetails[]
): Promise<string> {
  requireNonEmpty(bundle, "bundle");

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
  return bundleId;
}

export async function sendJitoBundle(
  serializedTransactions: string[],
  jitoTipsConfig = getJitoTipsConfig(),
  config?: RetryConfig
): Promise<string> {
  requireNonEmpty(serializedTransactions, "serializedTransactions");
  const { blockEngineUrl: jitoBlockEngineUrl } = jitoTipsConfig;
  const url = `${jitoBlockEngineUrl}/bundles`;

  const response = await retryFetch(
    () =>
      fetch(url, {
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
      }),
    config
  );

  await validateResponse(response, url);
  const data = await parseJson<{ result?: string; error?: unknown }>(response);

  if (data.error) {
    throw new BundleError(
      `Error sending bundles: ${JSON.stringify(data.error, null, 2)}`
    );
  }

  if (!data.result) {
    throw new BundleError("No bundle ID returned from Jito");
  }

  return data.result;
}

export async function pollJitoBundleConfirmation(
  bundleId: string,
  maxRetries = BUNDLE_POLL_MAX_RETRIES,
  initialDelayMs = BUNDLE_POLL_DELAY_MS,
  jitoTipsConfig = getJitoTipsConfig()
): Promise<string> {
  requireNonEmptyString(bundleId, "bundleId");
  const { blockEngineUrl: jitoBlockEngineUrl } = jitoTipsConfig;
  const url = `${jitoBlockEngineUrl}/getBundleStatuses`;

  return retryWithBackoff(
    async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBundleStatuses",
          params: [[bundleId]],
        }),
      });

      await validateResponse(response, url);
      const data = await parseJson<{
        result?: BundleStatusResponse;
        error?: unknown;
      }>(response);

      if (data.error) {
        throw new BundleError(
          `Error getting bundle status: ${JSON.stringify(data.error, null, 2)}`,
          bundleId
        );
      }

      if (!data.result?.value?.length) {
        throw new BundleError("Bundle not yet confirmed", bundleId);
      }

      const status = data.result.value[0];
      if (
        status.confirmation_status === "confirmed" ||
        status.confirmation_status === "finalized"
      ) {
        const lastTx = status.transactions[status.transactions.length - 1];
        if (!lastTx) {
          throw new BundleError(
            "No transactions in confirmed bundle",
            bundleId
          );
        }
        return lastTx;
      }

      throw new BundleError(
        `Bundle status: ${status.confirmation_status}`,
        bundleId
      );
    },
    {
      maxRetries,
      initialDelayMs,
      shouldRetry: createShouldRetryForErrors(BundleError, NetworkError),
    }
  );
}

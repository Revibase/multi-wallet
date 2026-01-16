/**
 * Jito bundle utilities for sending and polling bundles
 */

import { getBase64EncodedWireTransaction } from "gill";
import {
  BUNDLE_POLL_DELAY_MS,
  BUNDLE_POLL_MAX_RETRIES,
  DEFAULT_NETWORK_RETRY_DELAY_MS,
  DEFAULT_NETWORK_RETRY_MAX_RETRIES,
} from "../../constants";
import { BundleError, NetworkError } from "../../errors";
import type { TransactionDetails } from "../../types";
import { parseJson, validateResponse } from "../async";
import { getJitoTipsConfig, getSolanaRpcEndpoint } from "../initialize";
import { retryFetch, retryWithBackoff } from "../retry";
import { createEncodedBundle, simulateBundle } from "../transaction/internal";
import { requireNonEmpty, requireNonEmptyString } from "../validation";

/**
 * Bundle status response type
 */
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

/**
 * Signs and sends bundled transactions to Jito
 * @param bundle - Array of transaction details
 * @returns Bundle ID
 * @throws {BundleError} If bundle simulation or sending fails
 * @throws {ValidationError} If bundle is empty
 */
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

/**
 * Sends a bundle of transactions to Jito with exponential backoff retry
 * @param serializedTransactions - Array of base64-encoded transaction strings
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param initialDelayMs - Initial delay between retries in milliseconds (default: 500)
 * @param jitoTipsConfig - Jito configuration (default: from global state)
 * @returns Bundle ID
 * @throws {BundleError} If bundle sending fails after all retries
 * @throws {NetworkError} If network request fails
 * @throws {ValidationError} If transactions array is empty
 */
export async function sendJitoBundle(
  serializedTransactions: string[],
  maxRetries = DEFAULT_NETWORK_RETRY_MAX_RETRIES,
  initialDelayMs = DEFAULT_NETWORK_RETRY_DELAY_MS,
  jitoTipsConfig = getJitoTipsConfig()
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
    {
      maxRetries,
      initialDelayMs,
    }
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

/**
 * Polls Jito for bundle confirmation status with exponential backoff
 * @param bundleId - The bundle ID to check
 * @param maxRetries - Maximum number of retry attempts (default: 30)
 * @param initialDelayMs - Initial delay between polls in milliseconds (default: 3000)
 * @param jitoTipsConfig - Jito configuration (default: from global state)
 * @returns The signature of the last transaction in the bundle
 * @throws {BundleError} If bundle polling fails after all retries
 * @throws {NetworkError} If network request fails
 * @throws {ValidationError} If bundleId is empty
 */
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
        // Bundle not yet confirmed, will retry
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

      // Bundle is still processing, will retry
      throw new BundleError(
        `Bundle status: ${status.confirmation_status}`,
        bundleId
      );
    },
    {
      maxRetries,
      initialDelayMs,
      shouldRetry: (error) => {
        // Retry on BundleError (not yet confirmed) and NetworkError
        return error instanceof BundleError || error instanceof NetworkError;
      },
    }
  );
}

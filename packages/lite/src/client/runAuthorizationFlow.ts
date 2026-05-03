import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
} from "@revibase/core";
import type { RevibaseProvider } from "src/provider/main";
import type { StartPayload } from "src/utils";

/** Shared flow: startRequest → payload → popup or device signature → callback. Used by signIn, transferTokens, executeTransaction. */
export async function runAuthorizationFlow(
  provider: RevibaseProvider,
  buildPayload: (clientOrigin: string) => StartPayload,
  signal?: AbortSignal,
): Promise<CompleteMessageRequest | CompleteTransactionRequest> {
  // 1. Opens the popup.
  provider.startRequest();

  // 2. Build start request payload
  const payload = buildPayload(window.origin);

  // 3. Get client to signature on start request payload
  const { signature, rid, validTill } =
    await provider.onClientAuthorizationCallback(payload);

  // 4. Get user signature on request
  return await provider.sendPayloadToProviderViaPopup({
    request: { ...payload, rid, validTill },
    signal,
    signature,
  });
}

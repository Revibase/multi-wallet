import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
} from "@revibase/core";
import type { RevibaseProvider } from "src/provider/main";
import type { StartPayload } from "src/utils";
import { withRetry } from "src/utils/retry";

/** Shared flow: startRequest → payload → popup or device signature → callback. Used by signIn, transferTokens, executeTransaction. */
export async function runAuthorizationFlow(
  provider: RevibaseProvider,
  buildPayload: (rid: string, clientOrigin: string) => StartPayload,
  signal?: AbortSignal,
): Promise<CompleteMessageRequest | CompleteTransactionRequest> {
  const onConnectedCallback = async (rid: string, clientOrigin: string) => {
    const payload = buildPayload(rid, clientOrigin);
    const { signature, validTill } = await withRetry(() =>
      provider.onClientAuthorizationCallback(payload),
    );
    return { request: { ...payload, rid, validTill }, signature };
  };

  return await provider.sendRequestToPopupProvidr({
    onConnectedCallback,
    signal,
  });
}

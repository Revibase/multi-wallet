import type {
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import type { RevibaseProvider } from "src/provider/main";
import type {
  AuthorizationFlowOptions,
  AuthorizationFlowResult,
} from "src/utils";

/** Shared flow: startRequest → payload → popup or device signature → callback. Used by signIn, transferTokens, executeTransaction. */
export async function runAuthorizationFlow(
  provider: RevibaseProvider,
  buildPayload: (
    rid: string,
    redirectOrigin: string,
  ) => StartMessageRequest | StartTransactionRequest,
  options?: AuthorizationFlowOptions,
): Promise<AuthorizationFlowResult> {
  const { rid, redirectOrigin } = provider.startRequest(options?.channelId);

  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const payload = buildPayload(rid, redirectOrigin);

  const abortController = new AbortController();

  if (options?.signal) {
    if (options.signal.aborted) {
      abortController.abort();
    } else {
      options.signal.addEventListener("abort", () => abortController.abort());
    }
  }

  if (!options?.channelId) {
    provider
      .sendPayloadToProviderViaPopup({
        rid,
        signal: abortController.signal,
      })
      .catch((error) => abortController.abort(error));
  }

  const device = options?.channelId
    ? await provider.getDeviceSignature(
        JSON.stringify({ rid, channelId: options.channelId }),
      )
    : undefined;

  return provider.onClientAuthorizationCallback(
    payload as StartMessageRequest,
    abortController.signal,
    device,
    options?.channelId,
  ) as Promise<AuthorizationFlowResult>;
}

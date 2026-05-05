import type { CompleteTransactionRequest, UserInfo } from "@revibase/core";
import type { RevibaseProvider } from "src/provider/main";
import type { OnConnectedCallback } from "src/utils";

/** Shared flow: startRequest → payload → popup or device signature → callback. Used by signIn, transferTokens, executeTransaction. */
export async function runAuthorizationFlow(
  provider: RevibaseProvider,
  onConnectedCallback: OnConnectedCallback,
  signal?: AbortSignal,
): Promise<{ user: UserInfo } | CompleteTransactionRequest> {
  return provider.sendRequestToPopupProvidr({
    onConnectedCallback,
    signal,
  });
}

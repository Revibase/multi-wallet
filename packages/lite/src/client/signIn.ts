import type { CompleteMessageRequest, UserInfo } from "@revibase/core";
import { getBase64Decoder } from "gill";
import { RevibaseProvider } from "src/provider/main";
import { createSignInMessageText } from "src/utils/internal";
import { withRetry } from "src/utils/retry";
import type { SignInAuthorizationFlowOptions } from "src/utils/types";
import { runAuthorizationFlow } from "./runAuthorizationFlow";

/** Opens auth popup (or channel when options.channelId). Returns user after passkey auth. Options: signal?, channelId?. */
export async function signIn(
  provider: RevibaseProvider,
  options?: SignInAuthorizationFlowOptions,
): Promise<{ user: UserInfo }> {
  const { signal } = options ?? {};
  const result = (await runAuthorizationFlow(
    provider,
    (rid, clientOrigin) => {
      const payload = {
        phase: "start" as const,
        rid,
        data: {
          type: "message" as const,
          payload: createSignInMessageText({
            domain: clientOrigin,
            nonce: getBase64Decoder().decode(
              crypto.getRandomValues(new Uint8Array(16)),
            ),
          }),
        },
        clientOrigin,
      };
      return payload;
    },
    signal,
  )) as CompleteMessageRequest;

  return await withRetry(() => provider.onClientAuthorizationCallback(result));
}

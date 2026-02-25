import type { StartMessageRequest, UserInfo } from "@revibase/core";
import { getBase64Decoder } from "gill";
import type { RevibaseProvider } from "src/provider/main";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import { createSignInMessageText } from "src/utils/internal";
import type { AuthorizationFlowOptions } from "src/utils/types";
import { runAuthorizationFlow } from "./runAuthorizationFlow";

/**
 * Opens the auth popup (or uses the channel when `options.channelId` is set) and returns user info after passkey auth.
 *
 * @param provider - The Revibase provider instance.
 * @param options - Optional. `signal`: abort the flow from the app (e.g. user clicks "Cancel"). `channelId`: use an existing channel (no popup).
 * @returns The signed-in user info.
 */
export async function signIn(
  provider: RevibaseProvider,
  options?: AuthorizationFlowOptions,
): Promise<{ user: UserInfo }> {
  return runAuthorizationFlow(
    provider,
    (rid, redirectOrigin) => {
      const payload: StartMessageRequest = {
        phase: "start",
        rid,
        validTill: Date.now() + DEFAULT_TIMEOUT,
        data: {
          type: "message" as const,
          payload: createSignInMessageText({
            domain: redirectOrigin,
            nonce: getBase64Decoder().decode(
              crypto.getRandomValues(new Uint8Array(16)),
            ),
          }),
        },
        redirectOrigin,
      };
      return payload;
    },
    options,
  ) as Promise<{ user: UserInfo }>;
}

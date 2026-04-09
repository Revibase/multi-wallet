import type { StartMessageRequest, UserInfo } from "@revibase/core";
import { getBase64Decoder } from "gill";
import { RevibaseProvider } from "src/provider/main";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import { createSignInMessageText } from "src/utils/internal";
import type { SignInAuthorizationFlowOptions } from "src/utils/types";
import { runAuthorizationFlow } from "./runAuthorizationFlow";

/** Opens auth popup (or channel when options.channelId). Returns user after passkey auth. Options: signal?, channelId?. */
export async function signIn(
  provider: RevibaseProvider,
  options?: SignInAuthorizationFlowOptions,
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
          trustedDeviceCheck: options?.trustedDeviceCheck ?? false,
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

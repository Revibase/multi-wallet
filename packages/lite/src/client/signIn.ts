import type { StartMessageRequest } from "@revibase/core";
import { getBase64Decoder } from "gill";
import type { RevibaseProvider } from "src/provider/main";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import type { User } from "src/utils";
import { createSignInMessageText } from "src/utils/internal";

/**
 * Initiates a sign-in flow using WebAuthn authentication.
 * Opens a popup window and handles the complete authentication process.
 *
 * @param provider - Revibase provider instance
 * @returns User information after successful authentication
 * @throws {Error} If authentication fails or popup is blocked
 */
export async function signIn(
  provider: RevibaseProvider,
): Promise<{ user: User }> {
  const redirectOrigin = window.origin;
  const rid = getBase64Decoder().decode(
    crypto.getRandomValues(new Uint8Array(16)),
  );
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
  await Promise.all([
    provider.onClientAuthorizationCallback(payload),
    provider.sendPayloadToProvider({
      rid,
      redirectOrigin,
    }),
  ]);

  return await provider.onClientAuthorizationCallback({
    phase: "complete",
    data: { type: "message", rid },
  });
}

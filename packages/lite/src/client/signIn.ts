import { getBase64Decoder } from "gill";
import type { RevibaseProvider } from "src/provider/main";
import type { StartCustomMessageRequest, User } from "src/utils";

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
  const payload: StartCustomMessageRequest = {
    phase: "start",
    data: { type: "message" as const, rid },
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

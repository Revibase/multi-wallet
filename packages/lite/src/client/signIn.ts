import type { StartMessageRequest } from "@revibase/core";
import type { RevibaseProvider } from "src/provider/main";
import type { User } from "src/utils";

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
  provider.openBlankPopUp();

  const redirectOrigin = window.origin;
  const payload: StartMessageRequest = {
    phase: "start",
    data: { type: "message" as const },
    redirectOrigin,
  };

  const { rid } = await provider.onClientAuthorizationCallback(payload);

  await provider.sendPayloadToProvider({
    rid,
  });

  return await provider.onClientAuthorizationCallback({
    phase: "complete",
    data: { type: "message", rid },
  });
}

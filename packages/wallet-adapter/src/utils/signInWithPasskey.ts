import { getBase64Decoder } from "gill";
import type { RevibaseProvider } from "src/provider";
import { WalletVerificationError } from "./errors.js";
import type { StartCustomMessageRequest } from "./types.js";

/**
 * Signs and verifies a message using WebAuthn passkey authentication.
 *
 * This function initiates a two-phase authentication flow:
 * 1. Start phase: Client signs a challenge and sends it to the provider
 * 2. Complete phase: Provider responds with authentication data, client verifies and processes
 *
 * @param input - Message signing parameters
 * @param input.signer - Optional signer public key
 * @param input.provider - Revibase provider instance
 * @returns User information and verification result
 * @throws {WalletVerificationError} If message signing or verification fails
 */
export async function signInWithPasskey({
  provider,
}: {
  provider: RevibaseProvider;
}) {
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

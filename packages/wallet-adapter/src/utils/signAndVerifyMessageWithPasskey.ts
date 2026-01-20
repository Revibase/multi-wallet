import type {
  CompleteMessageRequest,
  StartMessageRequest,
} from "@revibase/core";
import type { RevibaseProvider } from "src/provider";
import { WalletVerificationError } from "./errors.js";

/**
 * Signs and verifies a message using WebAuthn passkey authentication.
 *
 * This function initiates a two-phase authentication flow:
 * 1. Start phase: Client signs a challenge and sends it to the provider
 * 2. Complete phase: Provider responds with authentication data, client verifies and processes
 *
 * @param input - Message signing parameters
 * @param input.message - Optional message to sign. If not provided, a default sign-in message is used
 * @param input.signer - Optional signer public key
 * @param input.provider - Revibase provider instance
 * @returns User information and verification result
 * @throws {WalletVerificationError} If message signing or verification fails
 */
export async function signAndVerifyMessageWithPasskey({
  message,
  provider,
}: {
  message: string;
  provider: RevibaseProvider;
}) {
  provider.openBlankPopUp();
  const redirectOrigin = window.origin;
  const payload: StartMessageRequest = {
    phase: "start",
    data: { type: "message" as const, payload: message },
    redirectOrigin,
  };

  const {
    signature,
    message: initialMessage,
    id,
  } = await provider.onClientAuthorizationCallback(payload);

  const response = (await provider.sendPayloadToProvider({
    payload: {
      ...payload,
      data: { ...payload.data, payload: initialMessage },
    },
    signature,
  })) as CompleteMessageRequest;

  return await provider.onClientAuthorizationCallback({
    ...response,
    data: {
      ...response.data,
      payload: { ...response.data.payload, id, message: initialMessage },
    },
  });
}

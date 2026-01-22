import type { TransactionPayload } from "@revibase/core";
import {
  bufferToBase64URLString,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import { getBase64Decoder } from "gill";
import type { RevibaseProvider } from "src/provider";
import { WalletTransactionError } from "./errors.js";
import type { StartCustomTransactionRequest } from "./types.js";

/**
 * Signs a transaction using WebAuthn passkey authentication.
 *
 * This function initiates a two-phase authentication flow:
 * 1. Start phase: Client signs a challenge and sends it to the provider
 * 2. Complete phase: Provider responds with authentication data, client signs the completion
 *
 * @param input - Transaction signing parameters
 * @param input.transactionActionType - Type of transaction action (sync, execute, etc.)
 * @param input.transactionAddress - Address of the transaction account
 * @param input.transactionMessageBytes - Serialized transaction message bytes
 * @param input.signer - Optional signer public key
 * @param input.provider - Revibase provider instance
 * @returns Transaction authentication response with signatures
 * @throws {WalletTransactionError} If transaction signing fails
 */
export async function signTransactionWithPasskey({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  signer,
  rid,
  provider,
}: TransactionPayload & {
  signer?: string;
  rid?: string;
  provider: RevibaseProvider;
}): Promise<TransactionAuthenticationResponse> {
  const transactionPayload = {
    transactionActionType,
    transactionAddress,
    transactionMessageBytes: bufferToBase64URLString(transactionMessageBytes),
  };
  const redirectOrigin = window.origin;
  rid =
    rid ??
    getBase64Decoder().decode(crypto.getRandomValues(new Uint8Array(16)));

  const payload: StartCustomTransactionRequest = {
    phase: "start",
    data: {
      type: "transaction" as const,
      payload: transactionPayload,
      rid,
    },
    redirectOrigin,
    signer,
  };
  await Promise.all([
    provider.onClientAuthorizationCallback(payload),
    provider.sendPayloadToProvider({
      rid,
      redirectOrigin,
    }),
  ]);

  const { authResponse } = await provider.onClientAuthorizationCallback({
    phase: "complete",
    data: { type: "transaction", rid },
  });

  return authResponse;
}

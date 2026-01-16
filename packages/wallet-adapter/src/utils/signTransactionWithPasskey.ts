import type {
  CompleteTransactionRequest,
  StartTransactionRequest,
  TransactionPayload,
} from "@revibase/core";
import {
  bufferToBase64URLString,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import { WalletTransactionError } from "./errors.js";
import type { RevibaseProvider } from "src/provider";

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
  provider,
}: {
  transactionActionType: TransactionPayload["transactionActionType"];
  transactionAddress: TransactionPayload["transactionAddress"];
  transactionMessageBytes: TransactionPayload["transactionMessageBytes"];
  signer?: string;
  provider: RevibaseProvider;
}): Promise<TransactionAuthenticationResponse> {
  const transactionPayload = {
    transactionActionType,
    transactionAddress,
    transactionMessageBytes: bufferToBase64URLString(transactionMessageBytes),
  };
  const redirectOrigin = window.origin;

  const payload: StartTransactionRequest = {
    phase: "start",
    data: {
      type: "transaction" as const,
      payload: transactionPayload,
    },
    redirectOrigin,
    signer,
  };
  const { signature } = await provider.onClientAuthorizationCallback(payload);
  const response = (await provider.sendPayloadToProvider({
    payload,
    signature,
  })) as CompleteTransactionRequest;

  const { signature: finalSignature } =
    await provider.onClientAuthorizationCallback({
      ...response,
      data: {
        ...response.data,
        payload: { ...response.data.payload, transactionPayload },
      },
    });

  return {
    ...response.data.payload,
    transactionPayload,
    clientSignature: {
      ...response.data.payload.clientSignature,
      signature: finalSignature,
    },
  };
}

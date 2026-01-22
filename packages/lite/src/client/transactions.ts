import type { TransactionPayloadWithBase64MessageBytes } from "@revibase/core";
import {
  bufferToBase64URLString,
  prepareTransactionMessage,
} from "@revibase/core";
import {
  address,
  getBase64Decoder,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import type { RevibaseProvider } from "src/provider/main";
import type { StartCustomTransactionRequest, User } from "src/utils/types";

/**
 * Executes a transaction using the Revibase provider.
 * Automatically determines whether to use bundling based on transaction size.
 *
 * @param provider - Revibase provider instance
 * @param args - Transaction arguments including instructions, signer, and optional lookup tables
 * @returns Transaction signature
 * @throws {Error} If transaction execution fails
 */
export async function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: User;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
  rid?: string,
): Promise<{ txSig: string }> {
  const { instructions, signer, addressesByLookupTableAddress } = args;
  const transactionMessageBytes = prepareTransactionMessage({
    payer: address(signer.walletAddress),
    instructions,
    addressesByLookupTableAddress,
  });

  const transactionPayloadWithoutType: Omit<
    TransactionPayloadWithBase64MessageBytes,
    "transactionActionType" | "transactionAddress"
  > = {
    transactionMessageBytes: bufferToBase64URLString(
      new Uint8Array(transactionMessageBytes),
    ),
  };

  const redirectOrigin = window.origin;
  rid =
    rid ??
    getBase64Decoder().decode(crypto.getRandomValues(new Uint8Array(16)));

  const payload: StartCustomTransactionRequest = {
    phase: "start",
    data: {
      type: "transaction" as const,
      payload: transactionPayloadWithoutType,
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

  return await provider.onClientAuthorizationCallback({
    phase: "complete",
    data: { type: "transaction", rid },
  });
}

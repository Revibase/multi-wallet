import type {
  CompleteTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
} from "@revibase/core";
import {
  bufferToBase64URLString,
  prepareTransactionMessage,
} from "@revibase/core";
import {
  address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import type { RevibaseProvider } from "src/provider/main";
import type {
  StartTransactionRequestWithOptionalType,
  User,
} from "src/utils/types";

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
  }
): Promise<{ txSig: string }> {
  provider.openBlankPopUp();

  const { instructions, signer, addressesByLookupTableAddress } = args;
  const transactionMessageBytes = prepareTransactionMessage({
    payer: address(signer.walletAddress),
    instructions,
    addressesByLookupTableAddress,
  });

  const redirectOrigin = window.origin;

  const transactionPayloadWithoutType: Omit<
    TransactionPayloadWithBase64MessageBytes,
    "transactionActionType" | "transactionAddress"
  > = {
    transactionMessageBytes: bufferToBase64URLString(
      new Uint8Array(transactionMessageBytes)
    ),
  };

  const payload: StartTransactionRequestWithOptionalType = {
    phase: "start",
    data: {
      type: "transaction" as const,
      payload: transactionPayloadWithoutType,
    },
    redirectOrigin,
    signer,
  };

  const { signature, transactionPayload } =
    await provider.onClientAuthorizationCallback(payload);
  const response = (await provider.sendPayloadToProvider({
    payload: {
      ...payload,
      signer: signer.publicKey,
      data: { ...payload.data, payload: transactionPayload },
    },
    signature,
  })) as CompleteTransactionRequest;

  return await provider.onClientAuthorizationCallback({
    ...response,
    data: {
      ...response.data,
      payload: { ...response.data.payload, transactionPayload },
    },
  });
}

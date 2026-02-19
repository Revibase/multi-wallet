import type {
  StartTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
  UserInfo,
} from "@revibase/core";
import {
  address,
  getAddressEncoder,
  getBase64Decoder,
  getU64Encoder,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";
import type { RevibaseProvider } from "src/provider/main";
import { DEFAULT_TIMEOUT } from "src/provider/utils";

/**
 * Transfers tokens (native SOL or SPL tokens) using the Revibase provider.
 *
 * @param provider - Revibase provider instance
 * @param args - Transfer arguments including amount, destination, and optional mint/token program
 * @returns Transaction signature
 * @throws {Error} If transfer fails
 */
export async function transferTokens(
  provider: RevibaseProvider,
  args: {
    amount: number | bigint;
    destination: string;
    signer?: UserInfo;
    mint?: string;
    tokenProgram?: string;
  },
): Promise<{ txSig: string; user: UserInfo }> {
  // Validate inputs
  if (args.amount <= 0) {
    throw new Error("Transfer amount must be greater than 0");
  }

  if (!args.destination || typeof args.destination !== "string") {
    throw new Error("Destination address is required");
  }

  const { rid, redirectOrigin } = provider.createNewPopup();

  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const {
    mint,
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    amount,
    destination,
    signer,
  } = args;

  const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
    transactionActionType: "transfer_intent",
    transactionAddress: mint ? tokenProgram : SYSTEM_PROGRAM_ADDRESS,
    transactionMessageBytes: getBase64Decoder().decode(
      new Uint8Array([
        ...getU64Encoder().encode(amount),
        ...getAddressEncoder().encode(address(destination)),
        ...getAddressEncoder().encode(address(mint ?? SYSTEM_PROGRAM_ADDRESS)),
      ]),
    ),
  };

  const payload: StartTransactionRequest = {
    phase: "start",
    rid,
    validTill: Date.now() + DEFAULT_TIMEOUT,
    data: {
      type: "transaction" as const,
      payload: transactionPayload,
      sendTx: true,
    },
    redirectOrigin,
    signer: signer?.publicKey,
  };

  provider.onClientAuthorizationCallback(payload);
  await provider.sendPayloadToProvider({
    rid,
  });

  return await provider.onClientAuthorizationCallback({
    phase: "complete",
    data: { type: "transaction", rid },
  });
}

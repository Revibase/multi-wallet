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
import type { AuthorizationFlowOptions } from "src/utils/types";
import { runAuthorizationFlow } from "./runAuthorizationFlow";

/**
 * Transfers SOL or SPL tokens. Set `mint` for SPL; omit for native SOL. `amount` must be &gt; 0; `destination` is required.
 *
 * @param provider - The Revibase provider instance.
 * @param args - Transfer params: `amount`, `destination`, optional `signer`, `mint`, `tokenProgram`.
 * @param options - Optional. `signal`: abort the flow from the app. `channelId`: use an existing channel (no popup).
 * @returns The transaction signature (if sent) and user info.
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
  options?: AuthorizationFlowOptions,
): Promise<{ txSig?: string; user: UserInfo }> {
  if (args.amount <= 0) {
    throw new Error("Transfer amount must be greater than 0");
  }

  if (!args.destination || typeof args.destination !== "string") {
    throw new Error("Destination address is required");
  }

  const {
    mint,
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    amount,
    destination,
    signer,
  } = args;

  return runAuthorizationFlow(
    provider,
    (rid, redirectOrigin) => {
      const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
        transactionActionType: "transfer_intent",
        transactionAddress: mint ? tokenProgram : SYSTEM_PROGRAM_ADDRESS,
        transactionMessageBytes: getBase64Decoder().decode(
          new Uint8Array([
            ...getU64Encoder().encode(amount),
            ...getAddressEncoder().encode(address(destination)),
            ...getAddressEncoder().encode(
              address(mint ?? SYSTEM_PROGRAM_ADDRESS),
            ),
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
      return payload;
    },
    options,
  );
}

import type {
  AdditionalSignersParam,
  StartTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
  UserInfo,
} from "@revibase/core";
import {
  getSettingsFromIndex,
  prepareTransactionMessage,
} from "@revibase/core";
import {
  address,
  getBase64Decoder,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import type { RevibaseProvider } from "src/provider/main";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import type { AuthorizationFlowOptions } from "src/utils/types";
import { runAuthorizationFlow } from "./runAuthorizationFlow";

/**
 * Builds and executes a custom transaction. Action type is selected from wallet settings.
 *
 * @param provider - The Revibase provider instance.
 * @param args - Transaction params: `instructions`, `signer`, optional `hasTxManager`, `additionalSigners`, `addressesByLookupTableAddress`.
 * @param options - Optional. `signal`: abort the flow from the app. `channelId`: use an existing channel (no popup).
 * @returns The transaction signature (if sent) and user info.
 */
export async function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    hasTxManager?: boolean;
    additionalSigners?: AdditionalSignersParam;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
  options?: AuthorizationFlowOptions,
): Promise<{ txSig?: string; user: UserInfo }> {
  const {
    instructions,
    signer,
    addressesByLookupTableAddress,
    hasTxManager = true,
  } = args;

  const transactionMessageBytes = prepareTransactionMessage({
    payer: address(signer.walletAddress),
    instructions,
    addressesByLookupTableAddress,
  });
  const settings = await getSettingsFromIndex(
    signer.settingsIndexWithAddress.index,
  );

  return runAuthorizationFlow(
    provider,
    (rid, redirectOrigin) => {
      const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
        transactionMessageBytes: getBase64Decoder().decode(
          transactionMessageBytes,
        ),
        transactionAddress: settings,
        transactionActionType: hasTxManager
          ? "execute"
          : "create_with_preauthorized_execution",
      };

      const payload: StartTransactionRequest = {
        phase: "start",
        rid,
        validTill: Date.now() + DEFAULT_TIMEOUT,
        data: {
          type: "transaction" as const,
          payload: transactionPayload,
          sendTx: true,
          additionalSigners: args.additionalSigners,
        },
        redirectOrigin,
        signer: signer.publicKey,
      };
      return payload;
    },
    options,
  );
}

import type {
  AdditionalSignersParam,
  StartTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
  UserInfo,
} from "@revibase/core";
import {
  fetchSettingsAccountData,
  getSettingsFromIndex,
  prepareTransactionMessage,
  UserRole,
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

/** Custom transaction. Action from wallet settings (TransactionManager). Provider needs rpcEndpoint. Options: signal?, channelId?. */
export async function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    settingsIndexWithAddress?: {
      index: number | bigint;
      settingsAddressTreeIndex: number;
    };
    additionalSigners?: AdditionalSignersParam;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
  options?: AuthorizationFlowOptions,
): Promise<{ txSig?: string; user: UserInfo }> {
  const {
    instructions,
    signer,
    addressesByLookupTableAddress,
    settingsIndexWithAddress,
  } = args;

  const transactionMessageBytes = prepareTransactionMessage({
    payer: address(signer.walletAddress),
    instructions,
    addressesByLookupTableAddress,
  });
  const settingsArgs =
    settingsIndexWithAddress ?? signer.settingsIndexWithAddress;
  const settings = await getSettingsFromIndex(settingsArgs.index);
  const settingsData = await fetchSettingsAccountData(
    settings,
    settingsArgs.settingsAddressTreeIndex,
  );
  const hasTxManager = settingsData.members.some(
    (x) => x.role === UserRole.TransactionManager,
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

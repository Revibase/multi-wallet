import type {
  CompleteTransactionRequest,
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
  type TransactionSigner,
} from "gill";
import type { RevibaseProvider } from "src/provider/main";
import { withRetry } from "src/utils/retry";
import type { TransactionAuthorizationFlowOptions } from "src/utils/types";
import { sendTransaction } from "../utils/transactions";
import { runAuthorizationFlow } from "./runAuthorizationFlow";

/** Custom transaction. Action from wallet settings (TransactionManager). Provider needs rpcEndpoint. Options: signal?, channelId?. */
export async function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    payer?: TransactionSigner;
    settingsIndexWithAddress?: {
      index: number | bigint;
      settingsAddressTreeIndex: number;
    };
    additionalSigners?: TransactionSigner[];
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
  options?: TransactionAuthorizationFlowOptions,
): Promise<{ txSig?: string; user: UserInfo }> {
  const {
    instructions,
    signer,
    addressesByLookupTableAddress,
    settingsIndexWithAddress,
    additionalSigners,
    payer,
  } = args;

  const { signal } = options ?? {};

  if (!signer.walletAddress || !signer.settingsIndexWithAddress) {
    throw new Error("Signer is missing wallet address");
  }

  const transactionMessageBytes = prepareTransactionMessage({
    payer: address(signer.walletAddress),
    instructions,
    addressesByLookupTableAddress,
  });
  const settingsArgs =
    settingsIndexWithAddress ?? signer.settingsIndexWithAddress;
  const settings = await getSettingsFromIndex(settingsArgs.index);
  const settingsData = await withRetry(() =>
    fetchSettingsAccountData(settings, settingsArgs.settingsAddressTreeIndex),
  );
  const hasTxManager = settingsData.members.some(
    (x) => x.role === UserRole.TransactionManager,
  );

  const result = (await runAuthorizationFlow(
    provider,
    (rid, clientOrigin) => {
      const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
        transactionMessageBytes: getBase64Decoder().decode(
          transactionMessageBytes,
        ),
        transactionAddress: settings,
        transactionActionType: hasTxManager
          ? "execute"
          : "create_with_preauthorized_execution",
      };

      const payload = {
        phase: "start" as const,
        rid,
        data: {
          type: "transaction" as const,
          payload: transactionPayload,
        },
        clientOrigin,
        signer: signer.publicKey,
      };
      return payload;
    },
    signal,
  )) as CompleteTransactionRequest;

  const requestWithClientSignature = await withRetry(() =>
    provider.onClientAuthorizationCallback(result),
  );

  return await sendTransaction(provider, {
    request: requestWithClientSignature,
    options,
    additionalSigners,
    addressesByLookupTableAddress,
    payer,
  });
}

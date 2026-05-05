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

  if (!signer.walletAddress || !signer.settingsIndexWithAddress) {
    throw new Error("Signer is missing wallet address");
  }

  const onConnectedCallback = async (rid: string, clientOrigin: string) => {
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
    const { signature, validTill } = await withRetry(() =>
      provider.onClientAuthorizationCallback(payload),
    );
    return { request: { ...payload, rid, validTill }, signature };
  };

  const onSuccessCallback = async (
    result: CompleteTransactionRequest,
  ): Promise<{ txSig: string; user: UserInfo }> => {
    const value = await provider.onClientAuthorizationCallback(result);
    return sendTransaction(provider, {
      request: value,
      options,
      additionalSigners,
      addressesByLookupTableAddress,
      payer,
    });
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}

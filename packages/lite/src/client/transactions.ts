import type {
  CompleteTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
  UserInfo,
} from "@revibase/core";
import {
  fetchSettingsAccountData,
  getSettingsFromIndex,
  prepareTransactionMessage,
  UserInfoSchema,
  UserRole,
} from "@revibase/core";
import {
  address,
  getBase64Decoder,
  type AddressesByLookupTableAddress,
  type Instruction,
  type TransactionSigner,
} from "gill";
import type { RevibaseProvider } from "../provider/main";
import { withRetry } from "../utils/retry";
import { sendTransaction } from "../utils/transactions";
import type { TransactionAuthorizationFlowOptions } from "../utils/types";

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
      providerOrigin: provider.providerOrigin,
      rpId: provider.rpId,
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
    const { signature } = await provider.onClientAuthorizationCallback(result);
    const user = UserInfoSchema.parse(result.data.payload.additionalInfo);
    const txSig = await sendTransaction(provider, {
      user,
      request: {
        ...result,
        data: {
          ...result.data,
          payload: {
            ...result.data.payload,
            client: { ...result.data.payload.client, jws: signature },
          },
        },
      },
      options,
      additionalSigners,
      addressesByLookupTableAddress,
      payer,
    });

    return { user, txSig };
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}

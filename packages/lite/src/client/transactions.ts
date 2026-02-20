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

export async function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    hasTxManager?: boolean;
    additionalSigners?: AdditionalSignersParam;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
): Promise<{ txSig?: string; user: UserInfo }> {
  const { redirectOrigin, rid } = provider.startRequest();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

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

  const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
    transactionMessageBytes: getBase64Decoder().decode(transactionMessageBytes),
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
  const abortController = new AbortController();

  provider
    .sendPayloadToProviderViaPopup({
      rid,
      signal: abortController.signal,
    })
    .catch((error) => abortController.abort(error));

  return await provider.onClientAuthorizationCallback(
    payload,
    abortController.signal,
    await provider.getDeviceSignature(rid),
    provider.channelId,
  );
}

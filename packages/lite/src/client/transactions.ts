import type {
  CompleteTransactionRequest,
  StartTransactionRequest,
  TransactionPayloadWithBase64MessageBytes,
} from "@revibase/core";
import {
  bufferToBase64URLString,
  getSettingsFromIndex,
  prepareTransactionMessage,
} from "@revibase/core";
import {
  address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import type { RevibaseProvider } from "src/provider/main";
import { estimateTransactionSizeExceedLimit } from "src/utils/internal";
import type { User } from "src/utils/types";

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
  const useBundle = estimateTransactionSizeExceedLimit(
    instructions,
    addressesByLookupTableAddress
  );
  const settings = await getSettingsFromIndex(
    signer.settingsIndexWithAddress.index
  );

  const redirectOrigin = window.origin;

  const transactionPayload: TransactionPayloadWithBase64MessageBytes = {
    transactionActionType: useBundle
      ? signer.hasTxManager
        ? "execute"
        : "create_with_preauthorized_execution"
      : "sync",
    transactionAddress: settings,
    transactionMessageBytes: bufferToBase64URLString(
      new Uint8Array(transactionMessageBytes)
    ),
  };

  const payload: StartTransactionRequest = {
    phase: "start",
    data: {
      type: "transaction" as const,
      payload: transactionPayload,
    },
    redirectOrigin,
    signer: signer.publicKey,
  };

  const { signature } = await provider.onClientAuthorizationCallback(payload);
  const response = (await provider.sendPayloadToProvider({
    payload,
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

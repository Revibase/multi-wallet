import {
  getSettingsFromIndex,
  prepareTransactionMessage,
} from "@revibase/core";
import {
  address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "gill";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import { estimateTransactionSizeExceedLimit } from "src/utils/internal";
import { signAndSendTransactionWithPasskey } from "src/utils/signAndSendTransactionWithPasskey";
import type { ClientAuthorizationCallback } from "src/utils/types";

export async function executeTransaction(
  onClientAuthorizationCallback: ClientAuthorizationCallback,
  instructions: Instruction[],
  signer: {
    publicKey: string;
    walletAddress: string;
    settingsIndexWtihAddress: {
      index: number | bigint;
      settingsAddressTreeIndex: number;
    };
    hasTxManager: boolean;
  },
  addressesByLookupTableAddress?: AddressesByLookupTableAddress,
  authOrigin?: string,
  popUp?: Window | null | undefined
) {
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
    signer.settingsIndexWtihAddress.index
  );
  if (useBundle) {
    return signAndSendTransactionWithPasskey({
      signer: signer.publicKey,
      transactionActionType: signer.hasTxManager
        ? "execute"
        : "create_with_preauthorized_execution",
      transactionAddress: settings,
      transactionMessageBytes: new Uint8Array(transactionMessageBytes),
      popUp,
      onClientAuthorizationCallback,
      authOrigin: authOrigin ?? REVIBASE_AUTH_URL,
    });
  } else {
    return signAndSendTransactionWithPasskey({
      signer: signer.publicKey,
      transactionActionType: "sync",
      transactionAddress: settings,
      transactionMessageBytes: new Uint8Array(transactionMessageBytes),
      popUp,
      onClientAuthorizationCallback,
      authOrigin: authOrigin ?? REVIBASE_AUTH_URL,
    });
  }
}

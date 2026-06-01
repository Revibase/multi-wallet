import type { SignedSecp256r1Key } from "@revibase/core";
import {
  getSettingsFromIndex,
  type CompleteTransactionRequest,
} from "@revibase/core";
import { address, type TransactionSigner } from "@solana/kit";
import type { RevibaseProvider } from "../../provider";
import type { TransactionAuthorizationFlowOptions } from "../../utils";
import { linkAbortSignal } from "../abort";
import { processBundledTransaction } from "../../utils/transactions/processBundledTransaction";
import { processSyncTransaction } from "../../utils/transactions/processSyncTransaction";
import { processTokenTransfer } from "../../utils/transactions/processTokenTransfer";
import { pollTransactionConfirmation } from "./pollTransactionConfirmation";

export async function sendTransaction(
  provider: RevibaseProvider,
  params: {
    request: CompleteTransactionRequest;
    additionalVoters?: (TransactionSigner | SignedSecp256r1Key)[];
    additionalSigners?: TransactionSigner[];
    options?: TransactionAuthorizationFlowOptions;
    payer: TransactionSigner;
  },
): Promise<string> {
  const { request, additionalSigners, options, payer, additionalVoters } =
    params;
  const abortScope = linkAbortSignal(options?.signal);
  const scopedOptions: TransactionAuthorizationFlowOptions = {
    ...options,
    signal: abortScope.signal,
  };
  const { confirmTransaction = true } = scopedOptions;

  try {
    const settings =
      request.data.type === "transaction" &&
      request.data.payload.startRequest.data.payload.transactionActionType !==
        "transfer_intent"
        ? request.data.payload.startRequest.data.payload.transactionAddress
        : request.data.payload.user.settingsIndexWithAddress?.index
          ? await getSettingsFromIndex(
              request.data.payload.user.settingsIndexWithAddress.index,
            )
          : null;

    if (!settings) {
      throw Error("User is not delegated to any wallet");
    }

    let txSig: string;
    switch (
      request.data.payload.startRequest.data.payload.transactionActionType
    ) {
      case "transfer_intent":
        txSig = await processTokenTransfer({
          authResponse: request.data.payload,
          settings: address(settings),
          options: scopedOptions,
          payer,
          additionalVoters,
          abortScope,
        });
        break;
      case "execute":
      case "create_with_preauthorized_execution":
        txSig = await processBundledTransaction(provider, {
          authResponse: request.data.payload,
          settings: address(settings),
          additionalSigners,
          additionalVoters,
          options: scopedOptions,
          payer,
          abortScope,
        });
        break;
      case "sync":
        txSig = await processSyncTransaction({
          authResponse: request.data.payload,
          settings: address(settings),
          additionalSigners,
          additionalVoters,
          options: scopedOptions,
          payer,
          abortScope,
        });
        break;
      default:
        throw Error("Invalid Transaction Action Type for send tx payload.");
    }

    if (confirmTransaction) {
      await pollTransactionConfirmation(txSig, { signal: abortScope.signal });
    }

    return txSig;
  } finally {
    abortScope.dispose();
  }
}

import type { UserInfo } from "@revibase/core";
import {
  getSettingsFromIndex,
  type CompleteTransactionRequest,
} from "@revibase/core";
import {
  address,
  type AddressesByLookupTableAddress,
  type TransactionSigner,
} from "gill";
import type { RevibaseProvider } from "../../provider";
import type { TransactionAuthorizationFlowOptions } from "../../utils";
import { processBundledTransaction } from "../../utils/transactions/processBundledTransaction";
import { processSyncTransaction } from "../../utils/transactions/processSyncTransaction";
import { processTokenTransfer } from "../../utils/transactions/processTokenTransfer";
import { pollTransactionConfirmation } from "./pollTransactionConfirmation";

export async function sendTransaction(
  provider: RevibaseProvider,
  params: {
    user: UserInfo;
    request: CompleteTransactionRequest;
    additionalSigners?: TransactionSigner[];
    options?: TransactionAuthorizationFlowOptions;
    payer?: TransactionSigner;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
): Promise<string> {
  const {
    user,
    request,
    additionalSigners,
    options,
    payer,
    addressesByLookupTableAddress,
  } = params;
  const { confirmTransaction = true } = options ?? {};

  const settings =
    request.data.type === "transaction" &&
    request.data.payload.startRequest.data.payload.transactionActionType !==
      "transfer_intent"
      ? request.data.payload.startRequest.data.payload.transactionAddress
      : user.settingsIndexWithAddress?.index
        ? await getSettingsFromIndex(user.settingsIndexWithAddress.index)
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
        options,
        payer,
        addressesByLookupTableAddress,
      });
      break;
    case "execute":
    case "create_with_preauthorized_execution":
      txSig = await processBundledTransaction(provider, {
        authResponse: request.data.payload,
        settings: address(settings),
        additionalSigners,
        options,
        payer,
      });
      break;
    case "sync":
      txSig = await processSyncTransaction({
        authResponse: request.data.payload,
        settings: address(settings),
        additionalSigners,
        options,
        payer,
      });
      break;
    default:
      throw Error("Invalid Transaction Action Type for send tx payload.");
  }

  if (confirmTransaction) {
    await pollTransactionConfirmation(txSig);
  }

  return txSig;
}

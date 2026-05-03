import type { UserInfo } from "@revibase/core";
import {
  getSettingsFromIndex,
  UserInfoSchema,
  type CompleteTransactionRequest,
} from "@revibase/core";
import { address, type TransactionSigner } from "gill";
import type { RevibaseProvider } from "src/provider";
import type { TransactionAuthorizationFlowOptions } from "src/utils";
import { processBundledTransaction } from "src/utils/transactions/processBundledTransaction";
import { processSyncTransaction } from "src/utils/transactions/processSyncTransaction";
import { processTokenTransfer } from "src/utils/transactions/processTokenTransfer";
import { pollTransactionConfirmation } from "./pollTransactionConfirmation";

export async function sendTransaction(
  provider: RevibaseProvider,
  params: {
    request: CompleteTransactionRequest;
    additionalSigners?: TransactionSigner[];
    options?: TransactionAuthorizationFlowOptions;
    payer?: TransactionSigner;
  },
): Promise<{ txSig: string; user: UserInfo }> {
  const { request, additionalSigners, options, payer } = params;
  const { confirmTransaction = true } = options ?? {};
  if (request.data.payload.startRequest.data.type === "message") {
    throw new Error("Invalid request type.");
  }
  const userInfo = UserInfoSchema.parse(request.data.payload.additionalInfo);
  const settings =
    request.data.type === "transaction" &&
    request.data.payload.startRequest.data.payload.transactionActionType !==
      "transfer_intent"
      ? request.data.payload.startRequest.data.payload.transactionAddress
      : userInfo.settingsIndexWithAddress?.index
        ? await getSettingsFromIndex(userInfo.settingsIndexWithAddress.index)
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

  return { txSig, user: userInfo };
}

import {
  fetchSettingsAccountData,
  getSignedSecp256r1Key,
  prepareTransactionSync,
  retrieveTransactionManager,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import { getBase64Encoder, type Address, type TransactionSigner } from "gill";
import { ADDRESS_BY_LOOKUP_TABLE_ADDRESS } from "../lookuptable";
import type { TransactionAuthorizationFlowOptions } from "../types";
import { signAndSendTransaction } from "./solana-send";
import { getRandomPayer, getTransactionManagerSigner } from "./utils";

export async function processSyncTransaction(params: {
  authResponse: TransactionAuthenticationResponse;
  settings: Address;
  payer?: TransactionSigner;
  additionalSigners?: TransactionSigner[];
  settingsAddressTreeIndex?: number;
  options?: TransactionAuthorizationFlowOptions;
}): Promise<string> {
  const {
    authResponse,
    settings,
    payer,
    additionalSigners,
    settingsAddressTreeIndex,
    options,
  } = params;
  const { startRequest, signer } = authResponse;
  if (startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");

  const { transactionActionType, transactionMessageBytes } =
    startRequest.data.payload;

  if (transactionActionType !== "sync") {
    throw new Error("Transaction action type must be 'sync'");
  }

  const cachedAccounts = new Map();
  const [feePayer, settingsData, signedSigner] = await Promise.all([
    payer ?? getRandomPayer(),
    fetchSettingsAccountData(
      settings,
      settingsAddressTreeIndex,
      cachedAccounts,
    ),
    getSignedSecp256r1Key(authResponse),
  ]);

  const tm = retrieveTransactionManager(signer, settingsData);

  const transactionManagerSigner = await getTransactionManagerSigner({
    authResponses: [authResponse],
    transactionManagerAddress: tm?.transactionManagerAddress,
    userAddressTreeIndex: tm?.userAddressTreeIndex,
    transactionMessageBytes: getBase64Encoder().encode(transactionMessageBytes),
    onPendingApprovalsCallback:
      options?.pendingApprovalsCallback?.onPendingApprovalsCallback,
    onPendingApprovalsSuccess:
      options?.pendingApprovalsCallback?.onPendingApprovalsSuccess,
    abortSignal: options?.signal,
    cachedAccounts,
  });

  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];

  const { instructions, addressesByLookupTableAddress } =
    await prepareTransactionSync({
      compressed: settingsData.isCompressed,
      signers,
      payer: feePayer,
      transactionMessageBytes: getBase64Encoder().encode(
        transactionMessageBytes,
      ),
      settings,
      settingsAddressTreeIndex,
      cachedAccounts,
      additionalSigners,
    });

  const mergedAddresses = addressesByLookupTableAddress
    ? { ...addressesByLookupTableAddress, ...ADDRESS_BY_LOOKUP_TABLE_ADDRESS }
    : ADDRESS_BY_LOOKUP_TABLE_ADDRESS;

  return signAndSendTransaction({
    instructions,
    payer: feePayer,
    addressesByLookupTableAddress: mergedAddresses,
  });
}

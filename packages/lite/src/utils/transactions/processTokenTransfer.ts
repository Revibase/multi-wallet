import {
  fetchSettingsAccountData,
  getSignedSecp256r1Key,
  nativeTransferIntent,
  retrieveTransactionManager,
  tokenTransferIntent,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import {
  address,
  getAddressDecoder,
  getBase64Encoder,
  getU64Decoder,
  type Address,
  type TransactionSigner,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import { ADDRESS_BY_LOOKUP_TABLE_ADDRESS } from "../lookuptable";
import type { TransactionAuthorizationFlowOptions } from "../types";
import { signAndSendTransaction } from "./solana-send";
import { getRandomPayer, getTransactionManagerSigner } from "./utils";

export async function processTokenTransfer(params: {
  authResponse: TransactionAuthenticationResponse;
  settings: Address;
  payer?: TransactionSigner;
  settingsAddressTreeIndex?: number;
  options?: TransactionAuthorizationFlowOptions;
}): Promise<string> {
  const { authResponse, settings, settingsAddressTreeIndex, options, payer } =
    params;
  const { startRequest, signer } = authResponse;
  if (startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");

  const { transactionActionType, transactionAddress, transactionMessageBytes } =
    startRequest.data.payload;

  if (transactionActionType !== "transfer_intent") {
    throw new Error("Transaction action type must be 'transfer_intent'");
  }

  const message = getBase64Encoder().encode(transactionMessageBytes);
  const amount = getU64Decoder().decode(message.slice(0, 8));
  const destination = getAddressDecoder().decode(message.slice(8, 40));
  const mint = getAddressDecoder().decode(message.slice(40, 72));

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

  const instructions =
    mint !== SYSTEM_PROGRAM_ADDRESS
      ? await tokenTransferIntent({
          payer: feePayer,
          settings,
          settingsAddressTreeIndex,
          amount,
          signers,
          destination,
          mint,
          tokenProgram: address(transactionAddress),
          compressed: settingsData.isCompressed,
          cachedAccounts,
        })
      : await nativeTransferIntent({
          payer,
          settings,
          settingsAddressTreeIndex,
          amount,
          signers,
          destination,
          compressed: settingsData.isCompressed,
          cachedAccounts,
        });

  return signAndSendTransaction({
    instructions,
    payer: feePayer,
    addressesByLookupTableAddress: ADDRESS_BY_LOOKUP_TABLE_ADDRESS,
  });
}

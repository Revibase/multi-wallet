import {
  fetchSettings,
  getSignedSecp256r1Key,
  getSolanaRpc,
  prepareTransactionSync,
  retrieveTransactionManager,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import {
  getBase64Encoder,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import { withRetry } from "../retry";
import type { TransactionAuthorizationFlowOptions } from "../types";
import { signAndSendTransaction } from "./solana-send";
import {
  fetchAdditionalLoopUpTableIfNecessary,
  getRandomPayer,
  getTransactionManagerSigner,
} from "./utils";

export async function processSyncTransaction(params: {
  authResponse: TransactionAuthenticationResponse;
  settings: Address;
  payer?: TransactionSigner;
  additionalSigners?: TransactionSigner[];
  options?: TransactionAuthorizationFlowOptions;
}): Promise<string> {
  const { authResponse, settings, payer, additionalSigners, options } = params;
  const { startRequest, signer } = authResponse;
  if (startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");

  const { transactionActionType, transactionMessageBytes } =
    startRequest.data.payload;

  if (transactionActionType !== "sync") {
    throw new Error("Transaction action type must be 'sync'");
  }

  const [feePayer, settingsData, signedSigner] = await Promise.all([
    payer ?? getRandomPayer(),
    (await withRetry(() => fetchSettings(getSolanaRpc(), settings))).data,
    getSignedSecp256r1Key(authResponse),
  ]);

  const tm = retrieveTransactionManager(signer, settingsData);

  const transactionManagerSigner = await getTransactionManagerSigner({
    authResponses: [authResponse],
    transactionManagerAddress: tm?.transactionManagerAddress,
    transactionMessageBytes: getBase64Encoder().encode(transactionMessageBytes),
    onPendingApprovalsCallback:
      options?.pendingApprovalsCallback?.onPendingApprovalsCallback,
    onPendingApprovalsSuccess:
      options?.pendingApprovalsCallback?.onPendingApprovalsSuccess,
    abortSignal: options?.signal,
  });

  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];

  const { instructions, addressesByLookupTableAddress } =
    await prepareTransactionSync({
      signers,
      payer: feePayer,
      transactionMessageBytes: getBase64Encoder().encode(
        transactionMessageBytes,
      ),
      settings,
      additionalSigners,
    });

  return signAndSendTransaction({
    instructions,
    payer: feePayer,
    addressesByLookupTableAddress: await fetchAdditionalLoopUpTableIfNecessary(
      addressesByLookupTableAddress,
    ),
  });
}

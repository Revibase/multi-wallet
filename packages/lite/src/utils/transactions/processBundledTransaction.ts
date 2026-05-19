import {
  fetchSettings,
  getSignedSecp256r1Key,
  getSolanaRpc,
  prepareTransactionBundle,
  retrieveTransactionManager,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import { getBase64Encoder, type Address, type TransactionSigner } from "gill";
import type { RevibaseProvider } from "../../provider";
import { withRetry } from "../retry";
import type { TransactionAuthorizationFlowOptions } from "../types";
import { signAndSendBundledTransactions } from "./solana-send";
import {
  fetchAdditionalLoopUpTableIfNecessary,
  getRandomPayer,
  getTransactionManagerSigner,
} from "./utils";

export async function processBundledTransaction(
  provider: RevibaseProvider,
  params: {
    authResponse: TransactionAuthenticationResponse;
    settings: Address;
    payer?: TransactionSigner;
    additionalSigners?: TransactionSigner[];
    options?: TransactionAuthorizationFlowOptions;
  },
): Promise<string> {
  const { authResponse, settings, additionalSigners, options, payer } = params;
  const { startRequest, signer } = authResponse;
  if (startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");

  const { transactionActionType, transactionMessageBytes } =
    startRequest.data.payload;

  if (
    transactionActionType !== "execute" &&
    transactionActionType !== "create_with_preauthorized_execution"
  ) {
    throw new Error(
      "Transaction action type must be 'execute' or 'create_with_preauthorized_execution'",
    );
  }

  const [feePayer, settingsData, signedSigner] = await Promise.all([
    payer ?? getRandomPayer(),
    (await withRetry(() => fetchSettings(getSolanaRpc(), settings))).data,
    getSignedSecp256r1Key(authResponse),
  ]);

  const tm = retrieveTransactionManager(signer, settingsData);

  const [transactionManagerSigner, jitoBundlesTipAmount] = await Promise.all([
    getTransactionManagerSigner({
      authResponses: [authResponse],
      transactionManagerAddress: tm?.transactionManagerAddress,
      transactionMessageBytes: getBase64Encoder().encode(
        transactionMessageBytes,
      ),
      onPendingApprovalsCallback:
        options?.pendingApprovalsCallback?.onPendingApprovalsCallback,
      onPendingApprovalsSuccess:
        options?.pendingApprovalsCallback?.onPendingApprovalsSuccess,
      abortSignal: options?.signal,
    }),
    withRetry(() => provider.onEstimateJitoTipsCallback()),
  ]);

  const bundle = await prepareTransactionBundle({
    settings,
    transactionMessageBytes: getBase64Encoder().encode(
      transactionMessageBytes,
    ) as Uint8Array<ArrayBuffer>,
    creator: transactionManagerSigner ?? signedSigner,
    executor: transactionManagerSigner ? signedSigner : undefined,
    jitoBundlesTipAmount,
    additionalSigners,
    payer: feePayer,
  });

  const bundlesWithLookupTables = await Promise.all(
    bundle.map(async (x) => ({
      ...x,
      addressesByLookupTableAddress:
        await fetchAdditionalLoopUpTableIfNecessary(
          x.addressesByLookupTableAddress,
        ),
    })),
  );

  return signAndSendBundledTransactions(provider, bundlesWithLookupTables);
}

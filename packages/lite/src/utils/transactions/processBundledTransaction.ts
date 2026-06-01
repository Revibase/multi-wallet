import {
  getSignedSecp256r1Key,
  prepareTransactionBundle,
  SignedSecp256r1Key,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import {
  address,
  getBase64Encoder,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import type { RevibaseProvider } from "../../provider";
import type { AbortScope } from "../abort";
import { withRetry } from "../retry";
import type { TransactionAuthorizationFlowOptions } from "../types";
import { signAndSendBundledTransactions } from "./solana-send";
import {
  fetchAdditionalLoopUpTableIfNecessary,
  getTransactionManagerSigner,
} from "./utils";

export async function processBundledTransaction(
  provider: RevibaseProvider,
  params: {
    authResponse: TransactionAuthenticationResponse;
    settings: Address;
    payer: TransactionSigner;
    additionalVoters?: (TransactionSigner | SignedSecp256r1Key)[];
    additionalSigners?: TransactionSigner[];
    options?: TransactionAuthorizationFlowOptions;
    abortScope: AbortScope;
  },
): Promise<string> {
  const {
    authResponse,
    settings,
    additionalSigners,
    additionalVoters,
    options,
    payer,
    abortScope,
  } = params;
  const { startRequest, transactionManagerAddress } = authResponse;
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

  const signedSigner = await getSignedSecp256r1Key(authResponse);

  const [transactionManagerSigner, jitoBundlesTipAmount] = await Promise.all([
    getTransactionManagerSigner({
      authResponses: [authResponse],
      transactionManagerAddress: transactionManagerAddress
        ? address(transactionManagerAddress)
        : undefined,
      transactionMessageBytes: getBase64Encoder().encode(
        transactionMessageBytes,
      ),
      onPendingApprovalsCallback:
        options?.pendingApprovalsCallback?.onPendingApprovalsCallback,
      onPendingApprovalsSuccess:
        options?.pendingApprovalsCallback?.onPendingApprovalsSuccess,
      abortSignal: abortScope.signal,
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
    additionalVoters,
    additionalSigners,
    payer,
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

  return signAndSendBundledTransactions(
    provider,
    bundlesWithLookupTables,
    abortScope,
  );
}

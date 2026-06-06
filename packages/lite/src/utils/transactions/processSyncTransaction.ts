import {
  getSignedSecp256r1Key,
  prepareTransactionSync,
  SignedSecp256r1Key,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import {
  address,
  getBase64Encoder,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import type { AbortScope } from "../abort";
import type { TransactionAuthorizationFlowOptions } from "../types";
import { signAndSendTransaction } from "./solana-send";
import { getTransactionManagerSigner } from "./utils";

export async function processSyncTransaction(params: {
  authResponse: TransactionAuthenticationResponse;
  settings: Address;
  payer: TransactionSigner;
  additionalVoters?: (TransactionSigner | SignedSecp256r1Key)[];
  additionalSigners?: TransactionSigner[];
  options?: TransactionAuthorizationFlowOptions;
  abortScope: AbortScope;
}): Promise<string> {
  const {
    authResponse,
    settings,
    payer,
    additionalSigners,
    additionalVoters,
    options,
    abortScope,
  } = params;
  const { startRequest, transactionManagerAddress } = authResponse;
  if (startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");

  const { transactionActionType, transactionMessageBytes } =
    startRequest.data.payload;

  if (transactionActionType !== "sync") {
    throw new Error("Transaction action type must be 'sync'");
  }

  const signedSigner = await getSignedSecp256r1Key(authResponse);

  const transactionManagerSigner = await getTransactionManagerSigner({
    authResponses: [authResponse],
    transactionManagerAddress: transactionManagerAddress
      ? address(transactionManagerAddress)
      : undefined,
    transactionMessageBytes: getBase64Encoder().encode(transactionMessageBytes),
    onPendingApprovalsCallback:
      options?.pendingApprovalsCallback?.onPendingApprovalsCallback,
    onPendingApprovalsSuccess:
      options?.pendingApprovalsCallback?.onPendingApprovalsSuccess,
    abortSignal: abortScope.signal,
  });

  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner, ...(additionalVoters ?? [])]
    : [signedSigner, ...(additionalVoters ?? [])];

  const { instructions } = await prepareTransactionSync({
    signers,
    payer,
    transactionMessageBytes: getBase64Encoder().encode(transactionMessageBytes),
    settings,
    additionalSigners,
  });

  return signAndSendTransaction(
    {
      instructions,
      payer,
    },
    abortScope,
  );
}

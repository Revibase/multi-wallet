import {
  getSignedSecp256r1Key,
  nativeTransferIntent,
  SignedSecp256r1Key,
  tokenTransferIntent,
  type TransactionAuthenticationResponse,
} from "@revibase/core";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  address,
  getAddressDecoder,
  getBase64Encoder,
  getU64Decoder,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import type { AbortScope } from "../abort";
import type { InternalTransactionFlowOptions } from "../types";
import { signAndSendTransaction } from "./solana-send";
import {
  fetchAdditionalLoopUpTableIfNecessary,
  getTransactionManagerSigner,
} from "./utils";

export async function processTokenTransfer(params: {
  authResponse: TransactionAuthenticationResponse;
  settings: Address;
  additionalVoters?: (TransactionSigner | SignedSecp256r1Key)[];
  payer: TransactionSigner;
  options?: InternalTransactionFlowOptions;
  abortScope: AbortScope;
}): Promise<string> {
  const { authResponse, settings, options, payer, additionalVoters, abortScope } =
    params;
  const { startRequest, transactionManagerAddress } = authResponse;
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

  const signedSigner = await getSignedSecp256r1Key(authResponse);

  const transactionManagerSigner = await getTransactionManagerSigner({
    authResponses: [authResponse],
    transactionManagerAddress: transactionManagerAddress
      ? address(transactionManagerAddress)
      : undefined,
    transactionMessageBytes: getBase64Encoder().encode(transactionMessageBytes),
    onPendingApprovalsCallback: (validTill) =>
      options?.reportStatus?.({ phase: "pending_approval", validTill }),
    onPendingApprovalsSuccess: () =>
      options?.reportStatus?.({ phase: "approved" }),
    abortSignal: abortScope.signal,
  });

  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner, ...(additionalVoters ?? [])]
    : [signedSigner, ...(additionalVoters ?? [])];

  const instructions =
    mint !== SYSTEM_PROGRAM_ADDRESS
      ? await tokenTransferIntent({
          payer,
          settings,
          amount,
          signers,
          destination,
          mint,
          tokenProgram: address(transactionAddress),
        })
      : await nativeTransferIntent({
          settings,
          amount,
          signers,
          destination,
        });

  return signAndSendTransaction(
    {
      instructions,
      payer,
      addressesByLookupTableAddress:
        await fetchAdditionalLoopUpTableIfNecessary(undefined),
    },
    abortScope,
  );
}

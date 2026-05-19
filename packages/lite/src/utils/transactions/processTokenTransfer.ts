import {
  fetchSettings,
  getSignedSecp256r1Key,
  getSolanaRpc,
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
  type AddressesByLookupTableAddress,
  type TransactionSigner,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import { withRetry } from "../retry";
import type { TransactionAuthorizationFlowOptions } from "../types";
import { signAndSendTransaction } from "./solana-send";
import {
  fetchAdditionalLoopUpTableIfNecessary,
  getRandomPayer,
  getTransactionManagerSigner,
} from "./utils";

export async function processTokenTransfer(params: {
  authResponse: TransactionAuthenticationResponse;
  settings: Address;
  payer?: TransactionSigner;
  options?: TransactionAuthorizationFlowOptions;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
}): Promise<string> {
  const {
    authResponse,
    settings,
    options,
    payer,
    addressesByLookupTableAddress,
  } = params;
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

  const instructions =
    mint !== SYSTEM_PROGRAM_ADDRESS
      ? await tokenTransferIntent({
          payer: feePayer,
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

  return signAndSendTransaction({
    instructions,
    payer: feePayer,
    addressesByLookupTableAddress: await fetchAdditionalLoopUpTableIfNecessary(
      addressesByLookupTableAddress,
    ),
  });
}

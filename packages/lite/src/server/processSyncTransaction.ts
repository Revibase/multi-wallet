import {
  base64URLStringToBuffer,
  prepareTransactionSync,
  signAndSendTransaction,
  type CompleteTransactionRequest,
} from "@revibase/core";
import type { TransactionSigner } from "gill";
import { getAddressByLookUpTable } from "src/utils/internal";
import { getTransactionSigners, prepareTransactionContext } from "./shared";

/**
 * Processes a synchronous transaction.
 * Used for transactions that don't require bundling.
 *
 * @param request - Complete transaction request
 * @param privateKey - Ed25519 private key for signing
 * @param feePayer - Optional fee payer (defaults to random payer from API)
 * @returns Transaction signature
 * @throws {Error} If transaction action type is not "sync"
 */
export async function processSyncTransaction(
  request: CompleteTransactionRequest,
  privateKey: CryptoKey,
  feePayer?: TransactionSigner
): Promise<string> {
  const { transactionActionType, transactionMessageBytes } =
    request.data.payload.transactionPayload;

  if (transactionActionType !== "sync") {
    throw new Error("Transaction action type must be 'sync'");
  }

  const context = await prepareTransactionContext(
    request,
    privateKey,
    feePayer
  );
  const signers = getTransactionSigners(
    context.signedSigner,
    context.transactionManagerSigner
  );

  const transactionMessageBytesBuffer = new Uint8Array(
    base64URLStringToBuffer(transactionMessageBytes)
  );

  const cachedAccounts = new Map();
  const { instructions, addressesByLookupTableAddress } =
    await prepareTransactionSync({
      compressed: context.settingsData.isCompressed,
      signers,
      payer: context.payer,
      transactionMessageBytes: transactionMessageBytesBuffer,
      index: context.settingsIndexWithAddress.index,
      settingsAddressTreeIndex:
        context.settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts,
    });

  const lookupTableAddresses = getAddressByLookUpTable();
  const mergedAddresses = addressesByLookupTableAddress
    ? { ...addressesByLookupTableAddress, ...lookupTableAddresses }
    : lookupTableAddresses;

  return signAndSendTransaction({
    instructions,
    payer: context.payer,
    addressesByLookupTableAddress: mergedAddresses,
  });
}

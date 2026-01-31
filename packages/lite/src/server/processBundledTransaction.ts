import {
  pollJitoBundleConfirmation,
  prepareTransactionBundle,
  signAndSendBundledTransactions,
  type CompleteTransactionRequest,
} from "@revibase/core";
import { getBase64Encoder, type TransactionSigner } from "gill";
import { estimateJitoTips, getAddressByLookUpTable } from "src/utils/internal";
import { prepareTransactionContext } from "./shared";

export async function processBundledTransaction(
  request: CompleteTransactionRequest,
  privateKey: string,
  feePayer?: TransactionSigner,
): Promise<string> {
  const { transactionActionType, transactionMessageBytes } =
    request.data.payload.transactionPayload;

  if (
    transactionActionType !== "execute" &&
    transactionActionType !== "create_with_preauthorized_execution"
  ) {
    throw new Error(
      "Transaction action type must be 'execute' or 'create_with_preauthorized_execution'",
    );
  }

  const context = await prepareTransactionContext(
    request,
    privateKey,
    feePayer,
  );
  const [jitoBundlesTipAmount] = await Promise.all([estimateJitoTips()]);

  const cachedAccounts = new Map();
  const bundle = await prepareTransactionBundle({
    compressed: context.settingsData.isCompressed,
    index: context.settingsIndexWithAddress.index,
    settingsAddressTreeIndex:
      context.settingsIndexWithAddress.settingsAddressTreeIndex,
    transactionMessageBytes: getBase64Encoder().encode(
      transactionMessageBytes,
    ) as Uint8Array<ArrayBuffer>,
    creator: context.transactionManagerSigner ?? context.signedSigner,
    executor: context.transactionManagerSigner
      ? context.signedSigner
      : undefined,
    jitoBundlesTipAmount,
    payer: context.payer,
    cachedAccounts,
  });

  const lookupTableAddresses = getAddressByLookUpTable();
  const bundlesWithLookupTables = bundle.map((x) => ({
    ...x,
    addressesByLookupTableAddress: x.addressesByLookupTableAddress
      ? { ...x.addressesByLookupTableAddress, ...lookupTableAddresses }
      : lookupTableAddresses,
  }));

  const bundleId = await signAndSendBundledTransactions(
    bundlesWithLookupTables,
  );

  return pollJitoBundleConfirmation(bundleId);
}

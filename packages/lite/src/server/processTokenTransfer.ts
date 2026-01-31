import {
  nativeTransferIntent,
  signAndSendTransaction,
  tokenTransferIntent,
  type CompleteTransactionRequest,
} from "@revibase/core";
import {
  address,
  getAddressDecoder,
  getBase64Encoder,
  getU64Decoder,
  type TransactionSigner,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import { getAddressByLookUpTable } from "src/utils/internal";
import { getTransactionSigners, prepareTransactionContext } from "./shared";

export async function processTokenTransfer(
  request: CompleteTransactionRequest,
  privateKey: string,
  feePayer?: TransactionSigner,
): Promise<string> {
  const { transactionActionType, transactionMessageBytes, transactionAddress } =
    request.data.payload.transactionPayload;

  if (transactionActionType !== "transfer_intent") {
    throw new Error("Transaction action type must be 'transfer_intent'");
  }

  const context = await prepareTransactionContext(
    request,
    privateKey,
    feePayer,
  );
  const message = getBase64Encoder().encode(transactionMessageBytes);
  const amount = getU64Decoder().decode(message.slice(0, 8));
  const destination = getAddressDecoder().decode(message.slice(8, 40));
  const mint = getAddressDecoder().decode(message.slice(40, 72));

  const signers = getTransactionSigners(
    context.signedSigner,
    context.transactionManagerSigner,
  );

  const cachedAccounts = new Map();
  const instructions =
    mint !== SYSTEM_PROGRAM_ADDRESS
      ? await tokenTransferIntent({
          payer: context.payer,
          index: context.settingsIndexWithAddress.index,
          settingsAddressTreeIndex:
            context.settingsIndexWithAddress.settingsAddressTreeIndex,
          amount,
          signers,
          destination,
          mint,
          tokenProgram: address(transactionAddress),
          compressed: context.settingsData.isCompressed,
          cachedAccounts,
        })
      : await nativeTransferIntent({
          payer: context.payer,
          index: context.settingsIndexWithAddress.index,
          settingsAddressTreeIndex:
            context.settingsIndexWithAddress.settingsAddressTreeIndex,
          amount,
          signers,
          destination,
          compressed: context.settingsData.isCompressed,
          cachedAccounts,
        });

  return signAndSendTransaction({
    instructions,
    payer: context.payer,
    addressesByLookupTableAddress: getAddressByLookUpTable(),
  });
}

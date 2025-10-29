import type { TransactionDetails } from "@revibase/core";
import {
  fetchSettingsAccountData,
  fetchUserAccountData,
  getFeePayer,
  getSignedSecp256r1Key,
  nativeTransferIntent,
  resolveTransactionManagerSigner,
  sendAndConfirmTransaction,
  signTransactionWithPasskey,
  tokenTransferIntent,
  type BasePayload,
} from "@revibase/core";
import type { AddressesByLookupTableAddress } from "gill";
import { getAddressEncoder, getU64Encoder, type Address } from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";

interface TokenTransferArgs extends BasePayload {
  amount: number | bigint;
  destination: Address;
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
}

/**
 *
 * @param mint If no mint is provided, Native SOL will be used for the transfer
 * @returns
 */
export async function signAndSendTokenTransfer(
  input: TokenTransferArgs
): Promise<string> {
  const transactionDetails = await buildTokenTransferInstruction(input);
  return sendAndConfirmTransaction(transactionDetails);
}

/**
 *
 * @param mint If no mint is provided, Native SOL will be used for the transfer
 * @returns
 */
export async function buildTokenTransferInstruction(
  input: TokenTransferArgs
): Promise<TransactionDetails> {
  const {
    amount,
    destination,
    mint,
    addressesByLookupTableAddress,
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    cachedAccounts = new Map<string, any>(),
    signer,
    popUp,
  } = input;
  const authResponse = await signTransactionWithPasskey({
    transactionActionType: "transfer_intent",
    transactionAddress: mint ? tokenProgram : SYSTEM_PROGRAM_ADDRESS,
    transactionMessageBytes: new Uint8Array([
      ...getU64Encoder().encode(amount),
      ...getAddressEncoder().encode(destination),
      ...getAddressEncoder().encode(mint ?? SYSTEM_PROGRAM_ADDRESS),
    ]),
    signer,
    popUp,
  });
  const signedSigner = await getSignedSecp256r1Key(authResponse);
  let index: number;
  if (!authResponse.additionalInfo.settingsIndex) {
    const userAccountData = await fetchUserAccountData(
      signedSigner,
      cachedAccounts
    );
    if (userAccountData.settingsIndex.__option === "None") {
      throw Error("User has no delegated wallet");
    }
    index = Number(userAccountData.settingsIndex.value);
  } else {
    index = authResponse.additionalInfo.settingsIndex;
  }
  const [settingsData, payer] = await Promise.all([
    fetchSettingsAccountData(index, cachedAccounts),
    getFeePayer(),
  ]);

  const transactionManagerSigner = await resolveTransactionManagerSigner({
    signer: signedSigner,
    index,
    cachedAccounts,
  });
  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];

  const instructions = mint
    ? await tokenTransferIntent({
        index,
        amount,
        signers,
        destination,
        mint,
        tokenProgram,
        compressed: settingsData.isCompressed,
        cachedAccounts,
      })
    : await nativeTransferIntent({
        index,
        amount,
        signers,
        destination,
        compressed: settingsData.isCompressed,
        cachedAccounts,
      });

  return { instructions, payer, addressesByLookupTableAddress };
}

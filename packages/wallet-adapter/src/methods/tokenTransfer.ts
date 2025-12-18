import type {
  SettingsIndexWithAddressArgs,
  TransactionDetails,
} from "@revibase/core";
import {
  fetchSettingsAccountData,
  fetchUserAccountData,
  getFeePayer,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  nativeTransferIntent,
  retrieveTransactionManager,
  Secp256r1Key,
  signAndSendTransaction,
  signTransactionWithPasskey,
  tokenTransferIntent,
} from "@revibase/core";
import type { AddressesByLookupTableAddress } from "gill";
import { getAddressEncoder, getU64Encoder, type Address } from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";

/**
 *
 * @param mint If no mint is provided, Native SOL will be used for the transfer
 * @returns
 */
export async function signAndSendTokenTransfer(input: {
  amount: number | bigint;
  destination: Address;
  createAtaIfNeeded?: boolean;
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signer?: string | undefined;
  popUp?: Window | null | undefined;
}): Promise<string> {
  const transactionDetails = await buildTokenTransferInstruction(input);
  return signAndSendTransaction(transactionDetails);
}

/**
 *
 * @param mint If no mint is provided, Native SOL will be used for the transfer
 * @returns
 */
export async function buildTokenTransferInstruction(input: {
  amount: number | bigint;
  destination: Address;
  createAtaIfNeeded?: boolean;
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signer?: string | undefined;
  popUp?: Window | null | undefined;
}): Promise<TransactionDetails> {
  const {
    amount,
    destination,
    mint,
    addressesByLookupTableAddress,
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    cachedAccounts = new Map<string, any>(),
    signer,
    popUp,
    createAtaIfNeeded = true,
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

  let settingsIndexWithAddress: SettingsIndexWithAddressArgs;
  if (!authResponse.additionalInfo.settingsIndexWithAddress) {
    const userAccountData = await fetchUserAccountData(
      new Secp256r1Key(authResponse.signer),
      authResponse.userAddressTreeIndex,
      cachedAccounts
    );
    if (userAccountData.delegatedTo.__option === "None") {
      throw Error("User has no delegated wallet");
    }
    settingsIndexWithAddress = userAccountData.delegatedTo.value;
  } else {
    settingsIndexWithAddress =
      authResponse.additionalInfo.settingsIndexWithAddress;
  }
  const [
    payer,
    settingsData,
    signedSigner,
    { transactionManagerAddress, userAddressTreeIndex },
  ] = await Promise.all([
    getFeePayer(),
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts
    ),
    getSignedSecp256r1Key(authResponse),
    retrieveTransactionManager(
      authResponse.signer,
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts
    ),
  ]);

  const transactionManagerSigner = await getSignedTransactionManager({
    authResponses: [authResponse],
    transactionManagerAddress,
    userAddressTreeIndex,
    cachedAccounts,
  });

  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];

  const instructions = mint
    ? await tokenTransferIntent({
        index: settingsIndexWithAddress.index,
        settingsAddressTreeIndex:
          settingsIndexWithAddress.settingsAddressTreeIndex,
        createAtaIfNeeded,
        amount,
        signers,
        destination,
        mint,
        tokenProgram,
        compressed: settingsData.isCompressed,
        cachedAccounts,
      })
    : await nativeTransferIntent({
        index: settingsIndexWithAddress.index,
        settingsAddressTreeIndex:
          settingsIndexWithAddress.settingsAddressTreeIndex,
        amount,
        signers,
        destination,
        compressed: settingsData.isCompressed,
        cachedAccounts,
      });

  return { instructions, payer, addressesByLookupTableAddress };
}

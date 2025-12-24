import type { SettingsIndexWithAddressArgs } from "@revibase/core";
import {
  fetchSettingsAccountData,
  fetchUserAccountData,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  nativeTransferIntent,
  retrieveTransactionManager,
  Secp256r1Key,
  signAndSendTransaction,
  tokenTransferIntent,
} from "@revibase/core";
import type { AddressesByLookupTableAddress, TransactionSigner } from "gill";
import { getAddressEncoder, getU64Encoder, type Address } from "gill";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "gill/programs";

import { REVIBASE_AUTH_URL } from "src/utils/consts";
import { signTransactionWithPasskey } from "src/utils/signTransactionWithPasskey";
import type { ClientAuthorizationCallback } from "src/utils/types";

/**
 *
 * @param mint If no mint is provided, Native SOL will be used for the transfer
 * @returns
 */
export async function signAndSendTokenTransfer(input: {
  amount: number | bigint;
  destination: Address;
  payer: TransactionSigner;
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  createAtaIfNeeded?: boolean;
  mint?: Address;
  tokenProgram?: Address;
  authOrigin?: string;
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
export const buildTokenTransferInstruction = async (input: {
  amount: number | bigint;
  destination: Address;
  payer: TransactionSigner;
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  authOrigin?: string;
  createAtaIfNeeded?: boolean;
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signer?: string | undefined;
  popUp?: Window | null | undefined;
}) => {
  const {
    amount,
    destination,
    mint,
    payer,
    addressesByLookupTableAddress,
    tokenProgram = TOKEN_PROGRAM_ADDRESS,
    cachedAccounts = new Map<string, any>(),
    signer,
    authOrigin = REVIBASE_AUTH_URL,
    popUp,
    onClientAuthorizationCallback,
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
    onClientAuthorizationCallback,
    authOrigin,
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
  const [settingsData, signedSigner] = await Promise.all([
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts
    ),
    getSignedSecp256r1Key(authResponse),
  ]);

  const { transactionManagerAddress, userAddressTreeIndex } =
    retrieveTransactionManager(authResponse.signer, settingsData);

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
        payer,
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
        payer,
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
};

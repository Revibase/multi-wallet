import type {
  SettingsIndexWithAddress,
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
  signAndSendTransaction,
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
  return signAndSendTransaction(transactionDetails);
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
  let settingsIndexWithAddress: SettingsIndexWithAddress;
  if (!authResponse.additionalInfo.settingsIndexWithAddress) {
    const userAccountData = await fetchUserAccountData(
      authResponse.signer,
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
  const [settingsData, payer] = await Promise.all([
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts
    ),
    getFeePayer(),
  ]);

  const { transactionManagerAddress, userAddressTreeIndex } =
    await retrieveTransactionManager(
      signedSigner,
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts
    );

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

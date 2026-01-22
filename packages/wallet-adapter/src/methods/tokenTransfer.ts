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
import type { RevibaseProvider } from "src/provider";

import { WalletTransactionError } from "src/utils/errors";
import { signTransactionWithPasskey } from "src/utils/signTransactionWithPasskey";

/**
 * Signs and sends a token transfer transaction.
 *
 * Supports both native SOL and SPL token transfers. If no mint is provided, a native SOL transfer is performed.
 *
 * @param input - Token transfer parameters
 * @param input.amount - Amount to transfer (number or bigint)
 * @param input.destination - Destination address for the transfer
 * @param input.payer - Transaction signer for paying fees
 * @param input.provider - Revibase provider instance
 * @param input.mint - Optional mint address. If not provided, native SOL is used
 * @param input.tokenProgram - Optional token program address (defaults to TOKEN_PROGRAM_ADDRESS)
 * @param input.cachedAccounts - Optional cache for account data
 * @param input.addressesByLookupTableAddress - Optional address lookup tables
 * @param input.signer - Optional signer public key
 * @returns Transaction signature string
 * @throws {WalletTransactionError} If the transfer fails
 */
export async function signAndSendTokenTransfer(input: {
  amount: number | bigint;
  destination: Address;
  payer: TransactionSigner;
  provider: RevibaseProvider;
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signer?: string | undefined;
}): Promise<string> {
  const transactionDetails = await buildTokenTransferInstruction(input);
  return signAndSendTransaction(transactionDetails);
}

/**
 * Builds token transfer instructions without sending the transaction.
 *
 * Supports both native SOL and SPL token transfers. If no mint is provided, a native SOL transfer is performed.
 *
 * @param input - Token transfer parameters
 * @param input.amount - Amount to transfer (number or bigint)
 * @param input.destination - Destination address for the transfer
 * @param input.payer - Transaction signer for paying fees
 * @param input.provider - Revibase provider instance
 * @param input.mint - Optional mint address. If not provided, native SOL is used
 * @param input.tokenProgram - Optional token program address (defaults to TOKEN_PROGRAM_ADDRESS)
 * @param input.cachedAccounts - Optional cache for account data
 * @param input.addressesByLookupTableAddress - Optional address lookup tables
 * @param input.signer - Optional signer public key
 * @returns Object containing instructions, payer, and optional address lookup tables
 * @throws {WalletTransactionError} If instruction building fails
 */
export const buildTokenTransferInstruction = async (input: {
  amount: number | bigint;
  destination: Address;
  payer: TransactionSigner;
  provider: RevibaseProvider;
  mint?: Address;
  tokenProgram?: Address;
  cachedAccounts?: Map<string, any>;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signer?: string;
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
    provider,
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
    provider,
  });

  let settingsIndexWithAddress: SettingsIndexWithAddressArgs;
  if (!authResponse.additionalInfo?.settingsIndexWithAddress) {
    const userAccountData = await fetchUserAccountData(
      new Secp256r1Key(authResponse.signer),
      authResponse.userAddressTreeIndex,
      cachedAccounts,
    );
    if (userAccountData.delegatedTo.__option === "None") {
      throw new WalletTransactionError("User has no delegated wallet");
    }
    settingsIndexWithAddress = userAccountData.delegatedTo.value;
  } else {
    settingsIndexWithAddress = authResponse.additionalInfo
      .settingsIndexWithAddress as SettingsIndexWithAddressArgs;
  }
  const [settingsData, signedSigner] = await Promise.all([
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts,
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

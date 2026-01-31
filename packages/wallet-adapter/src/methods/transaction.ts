import {
  fetchSettingsAccountData,
  getSettingsFromIndex,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  getWalletAddressFromIndex,
  prepareTransactionBundle,
  prepareTransactionMessage,
  prepareTransactionSync,
  retrieveTransactionManager,
  type SettingsIndexWithAddressArgs,
} from "@revibase/core";
import {
  createNoopSigner,
  type AddressesByLookupTableAddress,
  type Instruction,
  type TransactionSigner,
} from "gill";
import type { RevibaseProvider } from "src/provider";
import {
  estimateJitoTips,
  estimateTransactionSizeExceedLimit,
  simulateSecp256r1Signer,
} from "src/utils/internal";
import { signTransactionWithPasskey } from "src/utils/signTransactionWithPasskey";

/**
 * Builds a transaction or transaction bundle based on the provided instructions.
 *
 * This function handles both regular transactions and bundles (for large transactions).
 * It automatically determines whether to use a bundle based on transaction size estimation.
 *
 * @param input - Transaction building parameters
 * @param input.instructions - Array of instructions to include in the transaction
 * @param input.signer - Public key of the signer
 * @param input.payer - Transaction signer for paying fees
 * @param input.settingsIndexWithAddress - Settings account information
 * @param input.provider - Revibase provider instance
 * @param input.addressesByLookupTableAddress - Optional address lookup tables
 * @param input.additionalSigners - Optional additional transaction signers
 * @param input.cachedAccounts - Optional cache for account data
 * @returns Array of transaction details (single item for sync, multiple for bundle)
 * @throws {WalletNotConnectedError} If wallet is not connected
 * @throws {WalletTransactionError} If transaction building fails
 */
export const buildTransaction = async (input: {
  instructions: Instruction[];
  signer: string;
  payer: TransactionSigner;
  settingsIndexWithAddress: SettingsIndexWithAddressArgs;
  provider: RevibaseProvider;
  rid?: string;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  additionalSigners?: TransactionSigner[];
  cachedAccounts?: Map<string, any>;
}) => {
  let {
    addressesByLookupTableAddress,
    instructions,
    payer,
    additionalSigners,
    signer,
    settingsIndexWithAddress,
    provider,
    cachedAccounts = new Map(),
    rid,
  } = input;
  const [settingsData, settings, transactionMessageBytes] = await Promise.all([
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts,
    ),
    getSettingsFromIndex(settingsIndexWithAddress.index),
    prepareTransactionMessage({
      payer: await getWalletAddressFromIndex(settingsIndexWithAddress.index),
      instructions,
      addressesByLookupTableAddress,
    }),
  ]);

  const { transactionManagerAddress, userAddressTreeIndex } =
    retrieveTransactionManager(signer, settingsData);

  const useBundle = await estimateTransactionSizeExceedLimit({
    signers: [
      simulateSecp256r1Signer(),
      ...(additionalSigners ?? []),
      ...(transactionManagerAddress
        ? [createNoopSigner(transactionManagerAddress)]
        : []),
    ],
    compressed: settingsData.isCompressed,
    payer,
    index: settingsIndexWithAddress.index,
    settingsAddressTreeIndex: settingsIndexWithAddress.settingsAddressTreeIndex,
    transactionMessageBytes,
    addressesByLookupTableAddress,
    cachedAccounts,
  });
  if (useBundle) {
    const [authResponse, jitoBundlesTipAmount] = await Promise.all([
      signTransactionWithPasskey({
        rid,
        signer,
        transactionActionType: transactionManagerAddress
          ? "execute"
          : "create_with_preauthorized_execution",
        transactionAddress: settings,
        transactionMessageBytes,
        provider,
      }),
      estimateJitoTips(),
    ]);
    const [transactionManagerSigner, signedSigner] = await Promise.all([
      getSignedTransactionManager({
        authResponses: [authResponse],
        transactionMessageBytes,
        transactionManagerAddress,
        userAddressTreeIndex,
      }),
      getSignedSecp256r1Key(authResponse),
    ]);

    return await prepareTransactionBundle({
      compressed: settingsData.isCompressed,
      index: settingsIndexWithAddress.index,
      settingsAddressTreeIndex:
        settingsIndexWithAddress.settingsAddressTreeIndex,
      transactionMessageBytes,
      creator: transactionManagerSigner ?? signedSigner,
      executor: transactionManagerSigner ? signedSigner : undefined,
      jitoBundlesTipAmount,
      payer,
      additionalSigners,
      addressesByLookupTableAddress,
      cachedAccounts,
    });
  } else {
    const authResponse = await signTransactionWithPasskey({
      rid,
      signer,
      transactionActionType: "sync",
      transactionAddress: settings.toString(),
      transactionMessageBytes,
      provider,
    });
    const [transactionManagerSigner, signedSigner] = await Promise.all([
      getSignedTransactionManager({
        authResponses: [authResponse],
        transactionMessageBytes,
        transactionManagerAddress,
        userAddressTreeIndex,
      }),
      getSignedSecp256r1Key(authResponse),
    ]);

    return [
      await prepareTransactionSync({
        compressed: settingsData.isCompressed,
        signers: [
          signedSigner,
          ...(additionalSigners ?? []),
          ...(transactionManagerSigner ? [transactionManagerSigner] : []),
        ],
        payer,
        transactionMessageBytes,
        index: settingsIndexWithAddress.index,
        settingsAddressTreeIndex:
          settingsIndexWithAddress.settingsAddressTreeIndex,
        addressesByLookupTableAddress,
        cachedAccounts,
      }),
    ];
  }
};

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
import { createPopUp } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import {
  estimateJitoTips,
  estimateTransactionSizeExceedLimit,
  simulateSecp256r1Signer,
} from "src/utils/internal";
import { signTransactionWithPasskey } from "src/utils/signTransactionWithPasskey";
import type { ClientAuthorizationCallback } from "src/utils/types";

export const buildTransaction = async (input: {
  instructions: Instruction[];
  signer: string;
  payer: TransactionSigner;
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  authOrigin?: string;
  settingsIndexWithAddress: SettingsIndexWithAddressArgs;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  additionalSigners?: TransactionSigner[];
  cachedAccounts?: Map<string, any>;
}) => {
  // open popup first so that browser won't prompt user for permission
  const popUp = createPopUp();
  let {
    addressesByLookupTableAddress,
    instructions,
    payer,
    onClientAuthorizationCallback,
    additionalSigners,
    signer,
    settingsIndexWithAddress,
    authOrigin = REVIBASE_AUTH_URL,
    cachedAccounts = new Map(),
  } = input;

  const [settingsData, settings, transactionMessageBytes] = await Promise.all([
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts
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
        signer,
        transactionActionType: transactionManagerAddress
          ? "execute"
          : "create_with_preauthorized_execution",
        transactionAddress: settings,
        transactionMessageBytes: new Uint8Array(transactionMessageBytes),
        popUp,
        onClientAuthorizationCallback,
        authOrigin,
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
      signer,
      transactionActionType: "sync",
      transactionAddress: settings.toString(),
      transactionMessageBytes: new Uint8Array(transactionMessageBytes),
      popUp,
      onClientAuthorizationCallback,
      authOrigin,
    });
    const [transactionManagerSigner, signedSigner] = await Promise.all([
      getSignedTransactionManager({
        authResponses: [authResponse],
        transactionMessageBytes: new Uint8Array(transactionMessageBytes),
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

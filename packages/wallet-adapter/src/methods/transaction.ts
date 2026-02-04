import {
  fetchSettingsAccountData,
  getSettingsFromIndex,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  getWalletAddressFromIndex,
  prepareTransactionBundle,
  prepareTransactionMessage,
  retrieveTransactionManager,
} from "@revibase/core";
import {
  type AddressesByLookupTableAddress,
  type Instruction,
  type TransactionSigner,
} from "gill";
import type { RevibaseProvider } from "src/provider";
import { type User } from "src/utils";
import { estimateJitoTips } from "src/utils/internal";
import { signTransactionWithPasskey } from "src/utils/signTransactionWithPasskey";

export const buildTransaction = async (input: {
  user: User;
  instructions: Instruction[];
  payer: TransactionSigner;
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
    user,
    provider,
    cachedAccounts = new Map(),
    rid,
  } = input;

  const settings = await getSettingsFromIndex(
    user.settingsIndexWithAddress.index,
  );
  const walletAddress = await getWalletAddressFromIndex(
    user.settingsIndexWithAddress.index,
  );
  const settingsAddressTreeIndex =
    user.settingsIndexWithAddress.settingsAddressTreeIndex;
  const settingsData = await fetchSettingsAccountData(
    settings,
    settingsAddressTreeIndex,
    cachedAccounts,
  );
  const transactionMessageBytes = prepareTransactionMessage({
    payer: walletAddress,
    instructions,
    addressesByLookupTableAddress,
  });
  const { transactionManagerAddress, userAddressTreeIndex } =
    retrieveTransactionManager(user.publicKey, settingsData);

  const [authResponse, jitoBundlesTipAmount] = await Promise.all([
    signTransactionWithPasskey({
      rid,
      signer: user.publicKey,
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
    settings,
    settingsAddressTreeIndex,
    transactionMessageBytes,
    creator: transactionManagerSigner ?? signedSigner,
    executor: transactionManagerSigner ? signedSigner : undefined,
    jitoBundlesTipAmount,
    payer,
    additionalSigners,
    addressesByLookupTableAddress,
    cachedAccounts,
  });
};

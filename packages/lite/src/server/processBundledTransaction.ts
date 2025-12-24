import {
  base64URLStringToBuffer,
  createClientAuthorizationCompleteRequestChallenge,
  fetchSettingsAccountData,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  prepareTransactionBundle,
  retrieveTransactionManager,
  signAndSendBundledTransactions,
  type CompleteTransactionRequest,
} from "@revibase/core";
import { getBase58Decoder, type TransactionSigner } from "gill";
import { REVIBASE_API_URL } from "src/utils/consts";
import { getRandomPayer } from "src/utils/helper";
import {
  estimateJitoTips,
  getAddressByLookUpTable,
  getSettingsIndexWithAddress,
} from "src/utils/internal";

export async function processBundledTransaction(
  request: CompleteTransactionRequest,
  privateKey: CryptoKey,
  feePayer?: TransactionSigner
) {
  const { transactionActionType, transactionMessageBytes } =
    request.data.payload.transactionPayload;
  if (
    transactionActionType !== "execute" &&
    transactionActionType !== "create_with_preauthorized_execution"
  ) {
    throw new Error("Transaction Action not allowed.");
  }

  const challenge = createClientAuthorizationCompleteRequestChallenge(request);
  const signature = getBase58Decoder().decode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        new Uint8Array(challenge)
      )
    )
  );
  const authResponse = {
    ...request.data.payload,
    clientSignature: {
      ...request.data.payload.clientSignature,
      signature,
    },
  };
  const cachedAccounts = new Map();
  const settingsIndexWithAddress = await getSettingsIndexWithAddress(
    request,
    cachedAccounts
  );
  const [payer, settingsData, signedSigner, jitoBundlesTipAmount] =
    await Promise.all([
      feePayer ?? (await getRandomPayer(REVIBASE_API_URL)),
      fetchSettingsAccountData(
        settingsIndexWithAddress.index,
        settingsIndexWithAddress.settingsAddressTreeIndex,
        cachedAccounts
      ),
      getSignedSecp256r1Key(authResponse),
      estimateJitoTips(),
    ]);

  const { transactionManagerAddress, userAddressTreeIndex } =
    retrieveTransactionManager(request.data.payload.signer, settingsData);

  const transactionManagerSigner = await getSignedTransactionManager({
    authResponses: [authResponse],
    transactionManagerAddress,
    transactionMessageBytes: new Uint8Array(
      base64URLStringToBuffer(transactionMessageBytes)
    ),
    userAddressTreeIndex,
    cachedAccounts,
  });

  const bundle = await prepareTransactionBundle({
    compressed: settingsData.isCompressed,
    index: settingsIndexWithAddress.index,
    settingsAddressTreeIndex: settingsIndexWithAddress.settingsAddressTreeIndex,
    transactionMessageBytes: new Uint8Array(
      base64URLStringToBuffer(transactionMessageBytes)
    ),
    creator: transactionManagerSigner ?? signedSigner,
    executor: transactionManagerSigner ? signedSigner : undefined,
    jitoBundlesTipAmount,
    payer,
    cachedAccounts,
  });

  return signAndSendBundledTransactions(
    bundle.map((x) => ({
      ...x,
      addressesByLookupTableAddress: x.addressesByLookupTableAddress
        ? { ...x.addressesByLookupTableAddress, ...getAddressByLookUpTable() }
        : getAddressByLookUpTable(),
    }))
  );
}

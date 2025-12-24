import {
  base64URLStringToBuffer,
  createClientAuthorizationCompleteRequestChallenge,
  fetchSettingsAccountData,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  prepareTransactionSync,
  retrieveTransactionManager,
  signAndSendTransaction,
  type CompleteTransactionRequest,
} from "@revibase/core";
import { getBase58Decoder, type TransactionSigner } from "gill";
import { REVIBASE_API_URL } from "src/utils/consts";
import {
  getRandomPayer,
  getSettingsIndexWithAddress,
} from "src/utils/internal";

export async function processSyncTransaction(
  request: CompleteTransactionRequest,
  privateKey: CryptoKey,
  feePayer?: TransactionSigner
) {
  const { transactionActionType, transactionMessageBytes } =
    request.data.payload.transactionPayload;
  if (transactionActionType !== "sync") {
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
  const [payer, settingsData, signedSigner] = await Promise.all([
    feePayer ?? (await getRandomPayer(REVIBASE_API_URL)),
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts
    ),
    getSignedSecp256r1Key(authResponse),
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
  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];

  const { instructions, addressesByLookupTableAddress } =
    await prepareTransactionSync({
      compressed: settingsData.isCompressed,
      signers,
      payer,
      transactionMessageBytes: new Uint8Array(
        base64URLStringToBuffer(transactionMessageBytes)
      ),
      index: settingsIndexWithAddress.index,
      settingsAddressTreeIndex:
        settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts,
    });

  return signAndSendTransaction({
    instructions,
    payer,
    addressesByLookupTableAddress,
  });
}

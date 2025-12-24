import {
  base64URLStringToBuffer,
  createClientAuthorizationCompleteRequestChallenge,
  fetchSettingsAccountData,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  nativeTransferIntent,
  retrieveTransactionManager,
  signAndSendTransaction,
  tokenTransferIntent,
  type CompleteTransactionRequest,
} from "@revibase/core";
import {
  address,
  getAddressDecoder,
  getBase58Decoder,
  getU64Decoder,
  type TransactionSigner,
} from "gill";
import { SYSTEM_PROGRAM_ADDRESS } from "gill/programs";
import { REVIBASE_API_URL } from "src/utils/consts";
import { getRandomPayer } from "src/utils/helper";
import { getSettingsIndexWithAddress } from "src/utils/internal";

export async function processTokenTransfer(
  request: CompleteTransactionRequest,
  privateKey: CryptoKey,
  feePayer?: TransactionSigner
) {
  const { transactionActionType, transactionMessageBytes, transactionAddress } =
    request.data.payload.transactionPayload;
  if (transactionActionType !== "transfer_intent") {
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
  const message = new Uint8Array(
    base64URLStringToBuffer(transactionMessageBytes)
  );
  const amount = getU64Decoder().decode(message.slice(0, 8));
  const destination = getAddressDecoder().decode(message.slice(8, 40));
  const mint = getAddressDecoder().decode(message.slice(40, 72));
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
    userAddressTreeIndex,
    cachedAccounts,
  });

  const signers = transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];

  const instructions =
    mint !== SYSTEM_PROGRAM_ADDRESS
      ? await tokenTransferIntent({
          payer,
          index: settingsIndexWithAddress.index,
          settingsAddressTreeIndex:
            settingsIndexWithAddress.settingsAddressTreeIndex,
          amount,
          signers,
          destination,
          mint,
          tokenProgram: address(transactionAddress),
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

  return signAndSendTransaction({ instructions, payer });
}

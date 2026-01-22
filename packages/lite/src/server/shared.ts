/**
 * Shared utilities for transaction processing
 * Reduces code duplication across different transaction types
 */

import {
    base64URLStringToBuffer,
    createClientAuthorizationCompleteRequestChallenge,
    fetchSettingsAccountData,
    getSignedSecp256r1Key,
    getSignedTransactionManager,
    retrieveTransactionManager,
    type CompleteTransactionRequest,
} from "@revibase/core";
import { getBase58Decoder, type TransactionSigner } from "gill";
import { REVIBASE_API_URL } from "src/utils/consts";
import { getRandomPayer } from "src/utils/helper";
import { getSettingsIndexWithAddress } from "src/utils/internal";

/**
 * Common transaction processing context
 */
export interface TransactionProcessingContext {
  settingsIndexWithAddress: Awaited<
    ReturnType<typeof getSettingsIndexWithAddress>
  >;
  settingsData: Awaited<ReturnType<typeof fetchSettingsAccountData>>;
  signedSigner: Awaited<ReturnType<typeof getSignedSecp256r1Key>>;
  transactionManagerSigner: Awaited<
    ReturnType<typeof getSignedTransactionManager>
  > | null;
  payer: TransactionSigner;
}

/**
 * Creates a signed authentication response from a request and private key.
 *
 * @param request - Complete transaction request
 * @param privateKey - Ed25519 private key for signing
 * @returns Authentication response with client signature
 */
export async function createSignedAuthResponse(
  request: CompleteTransactionRequest,
  privateKey: CryptoKey
) {
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

  return {
    ...request.data.payload,
    clientSignature: {
      ...request.data.payload.clientSignature,
      signature,
    },
  };
}

/**
 * Prepares the common context needed for transaction processing.
 * This includes fetching settings, signing keys, and transaction manager setup.
 *
 * @param request - Complete transaction request
 * @param privateKey - Ed25519 private key for signing
 * @param feePayer - Optional fee payer (defaults to random payer from API)
 * @returns Transaction processing context
 */
export async function prepareTransactionContext(
  request: CompleteTransactionRequest,
  privateKey: CryptoKey,
  feePayer?: TransactionSigner
): Promise<TransactionProcessingContext> {
  const authResponse = await createSignedAuthResponse(request, privateKey);
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

  const transactionMessageBytes = new Uint8Array(
    base64URLStringToBuffer(
      request.data.payload.transactionPayload.transactionMessageBytes
    )
  );

  const transactionManagerSigner = await getSignedTransactionManager({
    authResponses: [authResponse],
    transactionManagerAddress,
    transactionMessageBytes,
    userAddressTreeIndex,
    cachedAccounts,
  });

  return {
    settingsIndexWithAddress,
    settingsData,
    signedSigner,
    transactionManagerSigner,
    payer,
  };
}

/**
 * Gets the signers array for a transaction.
 * Includes transaction manager signer if available.
 *
 * @param signedSigner - The signed user signer
 * @param transactionManagerSigner - Optional transaction manager signer
 * @returns Array of signers
 */
export function getTransactionSigners(
  signedSigner: TransactionProcessingContext["signedSigner"],
  transactionManagerSigner: TransactionProcessingContext["transactionManagerSigner"]
) {
  return transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];
}

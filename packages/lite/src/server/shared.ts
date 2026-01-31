/**
 * Shared utilities for transaction processing
 * Reduces code duplication across different transaction types
 */

import {
  convertBase64StringToJWK,
  createClientAuthorizationCompleteRequestChallenge,
  fetchSettingsAccountData,
  getSignedSecp256r1Key,
  getSignedTransactionManager,
  retrieveTransactionManager,
  type CompleteTransactionRequest,
} from "@revibase/core";
import { getBase64Encoder, type TransactionSigner } from "gill";
import { CompactSign } from "jose";
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
  privateKey: string,
) {
  const pkey = convertBase64StringToJWK(privateKey);
  if (!pkey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationCompleteRequestChallenge(request),
  )
    .setProtectedHeader({
      alg: pkey.alg,
    })
    .sign(pkey);

  return {
    ...request.data.payload,
    client: {
      clientOrigin: request.data.payload.client.clientOrigin,
      jws: signature,
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
  privateKey: string,
  feePayer?: TransactionSigner,
): Promise<TransactionProcessingContext> {
  const authResponse = await createSignedAuthResponse(request, privateKey);
  const cachedAccounts = new Map();

  const settingsIndexWithAddress = await getSettingsIndexWithAddress(
    request,
    cachedAccounts,
  );

  const [payer, settingsData, signedSigner] = await Promise.all([
    feePayer ?? (await getRandomPayer(REVIBASE_API_URL)),
    fetchSettingsAccountData(
      settingsIndexWithAddress.index,
      settingsIndexWithAddress.settingsAddressTreeIndex,
      cachedAccounts,
    ),
    getSignedSecp256r1Key(authResponse),
  ]);

  const { transactionManagerAddress, userAddressTreeIndex } =
    retrieveTransactionManager(request.data.payload.signer, settingsData);

  const transactionManagerSigner = await getSignedTransactionManager({
    authResponses: [authResponse],
    transactionManagerAddress,
    transactionMessageBytes: getBase64Encoder().encode(
      request.data.payload.transactionPayload.transactionMessageBytes,
    ),
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
  transactionManagerSigner: TransactionProcessingContext["transactionManagerSigner"],
) {
  return transactionManagerSigner
    ? [signedSigner, transactionManagerSigner]
    : [signedSigner];
}

import { equalBytes } from "@noble/curves/utils.js";
import type { CompleteMessageRequest } from "@revibase/core";
import {
  bufferToBase64URLString,
  convertBase64StringToJWK,
  convertMemberKeyToString,
  convertPubkeyCompressedToCose,
  createClientAuthorizationStartRequestChallenge,
  createMessageChallenge,
  fetchSettingsAccountData,
  fetchUserAccountByFilters,
  getDeviceMessageHash,
  getDomainConfigAddress,
  getSettingsFromIndex,
  UserRole,
} from "@revibase/core";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { address, verifySignatureForAddress } from "gill";
import { compactVerify, importJWK } from "jose";

/** Verifies WebAuthn message, returns user. */
export async function verifyMessage(
  request: CompleteMessageRequest,
  expectedClientJwk: string,
  allowedClientOrigins: string[],
  requireTwoFactorAuthentication: boolean,
) {
  const { payload } = request.data;
  if (payload.startRequest.data.type !== "message")
    throw new Error("Invalid request type.");
  if (Date.now() > payload.startRequest.validTill) {
    throw new Error("Request expired.");
  }
  if (
    !allowedClientOrigins.includes(payload.startRequest.clientOrigin) ||
    !allowedClientOrigins.includes(payload.client.clientOrigin) ||
    payload.startRequest.clientOrigin !== payload.client.clientOrigin
  ) {
    throw new Error("Invalid client origin");
  }

  {
    const key = await importJWK(convertBase64StringToJWK(expectedClientJwk));
    const result = await compactVerify(request.data.payload.client.jws, key);
    if (
      !equalBytes(
        result.payload,
        createClientAuthorizationStartRequestChallenge(
          request.data.payload.startRequest,
        ),
      )
    ) {
      throw new Error("Invalid client signature");
    }
  }

  {
    if (payload.device.jwk !== payload.device.deviceProfile.devicePublicKey) {
      throw new Error("Device publickey mismatch");
    }
    const key = await importJWK(convertBase64StringToJWK(payload.device.jwk));
    const result = await compactVerify(payload.device.jws, key);
    if (
      !equalBytes(
        result.payload,
        getDeviceMessageHash(
          payload.authResponse,
          payload.device.deviceProfile,
        ),
      )
    ) {
      throw new Error("Invalid device signature");
    }
  }

  const expectedChallenge = createMessageChallenge(
    payload.startRequest.data.payload,
    payload.startRequest.clientOrigin,
    payload.device.jwk,
    payload.startRequest.rid,
  );
  const { verified } = await verifyAuthenticationResponse({
    response: payload.authResponse,
    expectedChallenge: bufferToBase64URLString(expectedChallenge),
    expectedRPID: payload.startRequest.rpId,
    expectedOrigin: payload.startRequest.providerOrigin,
    requireUserVerification: false,
    credential: {
      counter: 0,
      id: payload.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(payload.signer),
    },
  });

  if (!verified) {
    throw new Error("Invalid user siganture");
  }

  if (requireTwoFactorAuthentication) {
    if (!payload.startRequest.data.requireTwoFactorAuthentication) {
      throw new Error("Two factor authentication is required.");
    }
    if (!payload.transactionManager) {
      throw new Error("Missing signature from transaction manager.");
    }

    const user = await fetchUserAccountByFilters(
      await getDomainConfigAddress({ rpId: payload.startRequest.rpId }),
      { credentialId: payload.authResponse.id },
    );
    const delegateTo = user?.wallets.find((x) => x.isDelegate);
    if (!delegateTo) {
      throw new Error("User does not have a delegated wallet");
    }
    const settingsData = await fetchSettingsAccountData(
      await getSettingsFromIndex(delegateTo.index),
    );
    const transactionManager = settingsData.members.find(
      (x) => x.role === UserRole.TransactionManager,
    );
    if (!transactionManager) {
      throw new Error("No transaction manager found.");
    }
    if (
      payload.transactionManager.publicKey !==
      convertMemberKeyToString(transactionManager.pubkey)
    ) {
      throw new Error("Transaction manager mismatch.");
    }
    if (
      !(await verifySignatureForAddress(
        address(payload.transactionManager.publicKey),
        payload.transactionManager.signature,
        expectedChallenge,
      ))
    ) {
      throw new Error("Invalid transaction manager signature.");
    }
  }

  return {
    ok: true,
  };
}

import { sha256 } from "@noble/hashes/sha2.js";
import {
  base64URLStringToBuffer,
  convertBase64UrlStringToJWK,
  createTransactionChallenge,
  getSecp256r1MessageHash,
  type TransactionAuthDetails,
  type TransactionBufferCreateArgs,
} from "@revibase/core";
import { getUtf8Decoder } from "gill";
import { compactVerify, importJWK } from "jose";
import type { ClientDataJSON, WellKnownClientCacheEntry } from "../types";
import { fetchWellKnownClient } from "./fetch-well-known";

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyAuthProviderSignature(
  authProvider: TransactionAuthDetails["authProvider"],
  messageHash: Uint8Array<ArrayBuffer>,
): Promise<void> {
  if (!authProvider) return;
  try {
    const key = await importJWK(convertBase64UrlStringToJWK(authProvider.jwk));
    const result = await compactVerify(authProvider.jws, key);
    if (!equalBytes(result.payload, messageHash)) {
      throw new Error("Invalid Payload");
    }
  } catch {
    throw new Error(`Auth provider signature verification failed`);
  }
}

export async function verifyDeviceSignature(
  device: TransactionAuthDetails["device"],
  messageHash: Uint8Array<ArrayBuffer>,
): Promise<void> {
  try {
    const key = await importJWK(convertBase64UrlStringToJWK(device.jwk));
    const result = await compactVerify(device.jws, key);
    if (!equalBytes(result.payload, messageHash)) {
      throw new Error("Invalid Payload");
    }
  } catch {
    throw new Error(`Device signature verification failed`);
  }
}

export async function verifyClientSignature(
  client: TransactionAuthDetails["client"],
  messageHash: Uint8Array<ArrayBuffer>,
  wellKnownProxyUrl?: URL,
): Promise<WellKnownClientCacheEntry> {
  const clientDetails = await fetchWellKnownClient(
    client.clientOrigin,
    wellKnownProxyUrl,
  );
  try {
    const key = await importJWK(
      convertBase64UrlStringToJWK(clientDetails.clientJwk),
    );
    const result = await compactVerify(client.jws, key);
    if (!equalBytes(result.payload, messageHash)) {
      throw new Error("Invalid Payload");
    }
  } catch {
    throw new Error(`Client signature verification failed `);
  }

  return clientDetails;
}

export async function verifyTransactionAuthResponseWithMessageHash(
  authDetails: TransactionAuthDetails,
  expectedMessageHash: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const {
    authResponse,
    transactionPayload,
    slotHash,
    slotNumber,
    device,
    client,
    nonce,
  } = authDetails;
  const { response } = authResponse;

  const clientDataJsonBytes = base64URLStringToBuffer(response.clientDataJSON);
  const clientDataJson = JSON.parse(
    getUtf8Decoder().decode(clientDataJsonBytes),
  ) as ClientDataJSON;

  const { challenge: expectedChallenge } = await createTransactionChallenge(
    transactionPayload,
    client.clientOrigin,
    device.jwk,
    nonce,
    slotHash,
    slotNumber,
  );

  const receivedChallenge = new Uint8Array(
    base64URLStringToBuffer(clientDataJson.challenge),
  );

  if (!equalBytes(receivedChallenge, expectedChallenge)) {
    throw new Error("Invalid challenge");
  }

  const actualMessageHash = getSecp256r1MessageHash(authResponse);
  if (!equalBytes(actualMessageHash, expectedMessageHash)) {
    throw new Error("Invalid message hash");
  }
} /**
 * Verifies that transaction buffer hash matches the provided transaction bytes.
 */

export async function verifyTransactionBufferHash(
  bufferArgs: TransactionBufferCreateArgs,
  transactionMessage: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const computedHash = sha256(transactionMessage);
  return equalBytes(new Uint8Array(bufferArgs.finalBufferHash), computedHash);
}

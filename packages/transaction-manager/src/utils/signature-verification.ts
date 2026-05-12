import { sha256 } from "@noble/hashes/sha2.js";
import {
  base64URLStringToBuffer,
  bufferToBase64URLString,
  convertBase64StringToJWK,
  convertPubkeyCompressedToCose,
  createMessageChallenge,
  createTransactionChallenge,
  getDeviceMessageHash,
  getSecp256r1MessageHash,
  type CompleteMessageRequest,
  type TransactionAuthDetails,
  type TransactionBufferCreateArgs,
} from "@revibase/core";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { getUtf8Decoder } from "gill";
import { compactVerify, importJWK } from "jose";
import type { ClientDataJSON, WellKnownClientEntry } from "../types";
import { fetchWellKnownClient } from "./fetch-well-known";

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyDeviceSignature(
  device: TransactionAuthDetails["device"],
  authResponse: AuthenticationResponseJSON,
): Promise<void> {
  if (device.jwk !== device.deviceProfile.devicePublicKey) {
    throw new Error("Device publickey mismatch");
  }
  try {
    const key = await importJWK(convertBase64StringToJWK(device.jwk));
    const result = await compactVerify(device.jws, key);
    if (
      !equalBytes(
        result.payload,
        getDeviceMessageHash(authResponse, device.deviceProfile),
      )
    ) {
      throw new Error("Invalid Payload");
    }
  } catch {
    throw new Error(`Device signature verification failed`);
  }
}

export async function verifyClientSignature(
  client: TransactionAuthDetails["client"],
  messageHash: Uint8Array<ArrayBuffer>,
  getClientDetails?: (clientOrigin: string) => Promise<WellKnownClientEntry>,
): Promise<WellKnownClientEntry> {
  const clientDetails =
    (await getClientDetails?.(client.clientOrigin)) ??
    (await fetchWellKnownClient(client.clientOrigin));
  try {
    const key = await importJWK(
      convertBase64StringToJWK(clientDetails.clientJwk),
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

/**
 * Make sure that transaction auth response matches message hash that is being verified on chain
 * @param authDetails
 * @param expectedMessageHash
 */
export async function verifyTransactionAuthResponseWithMessageHash(
  authDetails: TransactionAuthDetails,
  expectedMessageHash: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const {
    authResponse,
    startRequest,
    slotHash,
    slotNumber,
    device,
    client,
    estimatedSlotHashExpiry,
  } = authDetails;
  if (startRequest.data.type !== "transaction")
    throw new Error("Invalid request type.");
  if (client.clientOrigin !== startRequest.clientOrigin) {
    throw new Error("Client mismatch");
  }
  const { response } = authResponse;

  const clientDataJsonBytes = base64URLStringToBuffer(response.clientDataJSON);
  const clientDataJson = JSON.parse(
    getUtf8Decoder().decode(clientDataJsonBytes),
  ) as ClientDataJSON;

  const { challenge: expectedChallenge } = await createTransactionChallenge(
    startRequest.data.payload,
    startRequest.clientOrigin,
    device.jwk,
    startRequest.rid,
    slotHash,
    slotNumber,
    estimatedSlotHashExpiry,
  );

  const receivedChallenge = base64URLStringToBuffer(clientDataJson.challenge);
  if (!equalBytes(receivedChallenge, expectedChallenge)) {
    throw new Error("Invalid challenge");
  }

  const actualMessageHash = getSecp256r1MessageHash(authResponse);
  if (!equalBytes(actualMessageHash, expectedMessageHash)) {
    throw new Error("Invalid message hash");
  }
}

/**
 * Verifies that transaction buffer hash matches the provided transaction bytes.
 */
export async function verifyTransactionBufferHash(
  bufferArgs: TransactionBufferCreateArgs,
  transactionMessage: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const computedHash = sha256(transactionMessage);
  return equalBytes(bufferArgs.finalBufferHash as Uint8Array, computedHash);
}

/**
 * Verify user signature
 */
export async function verifyUserSignature(payload: CompleteMessageRequest) {
  const { startRequest } = payload.data.payload;
  const expectedChallenge = createMessageChallenge(
    startRequest.data.payload,
    startRequest.clientOrigin,
    payload.data.payload.device.jwk,
    startRequest.rid,
  );

  const { verified } = await verifyAuthenticationResponse({
    response: payload.data.payload.authResponse,
    expectedChallenge: bufferToBase64URLString(expectedChallenge),
    expectedRPID: startRequest.rpId,
    expectedOrigin: startRequest.providerOrigin,
    requireUserVerification: false,
    credential: {
      counter: 0,
      id: payload.data.payload.authResponse.id,
      publicKey: convertPubkeyCompressedToCose(payload.data.payload.signer),
    },
  });

  if (!verified) {
    throw new Error("Invalid user siganture");
  }
}

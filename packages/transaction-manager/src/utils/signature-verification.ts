import {
  base64URLStringToBuffer,
  createTransactionChallenge,
  getSecp256r1MessageHash,
  type TransactionAuthDetails,
} from "@revibase/core";
import { getBase58Encoder } from "gill";
import type { ClientDataJSON, WellKnownCacheEntry } from "../types";

const WELL_KNOWN_CACHE_TTL_MS = 300_000;
const wellKnownCache = new Map<string, WellKnownCacheEntry>();

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

async function verifyEd25519Signature(
  signature: string,
  messageHash: Uint8Array<ArrayBuffer>,
  publicKey: string,
  errorMessage: string,
): Promise<void> {
  const signatureBytes = new Uint8Array(getBase58Encoder().encode(signature));
  const publicKeyBytes = new Uint8Array(getBase58Encoder().encode(publicKey));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const isValid = await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    signatureBytes,
    messageHash,
  );

  if (!isValid) {
    throw new Error(errorMessage);
  }
}

export async function verifyAuthProviderSignature(
  authProviderSignature: { publicKey: string; signature: string } | undefined,
  messageHash: Uint8Array<ArrayBuffer>,
): Promise<void> {
  if (!authProviderSignature) {
    return;
  }

  await verifyEd25519Signature(
    authProviderSignature.signature,
    messageHash,
    authProviderSignature.publicKey,
    `Auth Provider signature verification failed for auth provider id: "${authProviderSignature.publicKey}".`,
  );
}

export async function verifyDeviceSignature(
  deviceSignature: { publicKey: string; signature: string },
  messageHash: Uint8Array<ArrayBuffer>,
): Promise<void> {
  await verifyEd25519Signature(
    deviceSignature.signature,
    messageHash,
    deviceSignature.publicKey,
    `Device signature verification failed for device id: "${deviceSignature.publicKey}".`,
  );
}

async function fetchWellKnownClientPublicKey(
  clientOrigin: string,
): Promise<{ publicKey: JsonWebKey }> {
  const now = Date.now();
  const cached = wellKnownCache.get(clientOrigin);

  if (cached && now - cached.timestamp < WELL_KNOWN_CACHE_TTL_MS) {
    return { publicKey: cached.publicKey };
  }

  const response = await fetch(`${clientOrigin}/.well-known/revibase.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch well-known for ${clientOrigin}`);
  }

  const data = (await response.json()) as
    | { publicKey: JsonWebKey }
    | null
    | undefined;
  if (!data?.publicKey) {
    throw new Error(`Invalid well-known response from ${clientOrigin}`);
  }

  wellKnownCache.set(clientOrigin, {
    publicKey: data.publicKey,
    timestamp: now,
  });

  return data;
}

export async function verifyClientSignature(
  clientSignature: { clientOrigin: string; signature: string },
  messageHash: Uint8Array,
): Promise<void> {
  const { publicKey: jwkPublicKey } = await fetchWellKnownClientPublicKey(
    clientSignature.clientOrigin,
  );

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwkPublicKey,
    { name: "Ed25519" },
    true,
    ["verify"],
  );

  const signatureBytes = new Uint8Array(
    getBase58Encoder().encode(clientSignature.signature),
  );

  const isValid = await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    signatureBytes,
    new Uint8Array(messageHash),
  );

  if (!isValid) {
    throw new Error(
      `Client signature verification failed for client: "${clientSignature.clientOrigin}".`,
    );
  }
}

export async function verifyTransactionAuthResponseWithMessageHash(
  authDetails: TransactionAuthDetails,
  expectedMessageHash: Uint8Array,
): Promise<void> {
  const {
    authResponse,
    transactionPayload,
    slotHash,
    slotNumber,
    deviceSignature,
    clientSignature,
    nonce,
  } = authDetails;
  const { response } = authResponse;

  const clientDataJsonBytes = base64URLStringToBuffer(response.clientDataJSON);
  const clientDataJson = JSON.parse(
    new TextDecoder().decode(clientDataJsonBytes),
  ) as ClientDataJSON;

  const { challenge: expectedChallenge } = await createTransactionChallenge(
    transactionPayload,
    clientSignature.clientOrigin,
    deviceSignature.publicKey,
    nonce,
    slotHash,
    slotNumber,
  );

  const receivedChallenge = new Uint8Array(
    base64URLStringToBuffer(clientDataJson.challenge),
  );

  if (!bytesEqual(receivedChallenge, expectedChallenge)) {
    throw new Error("Invalid challenge");
  }

  const actualMessageHash = getSecp256r1MessageHash(authResponse);
  if (!bytesEqual(actualMessageHash, expectedMessageHash)) {
    throw new Error("Invalid message hash");
  }
}

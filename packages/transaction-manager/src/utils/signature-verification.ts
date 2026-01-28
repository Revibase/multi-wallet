import {
  base64URLStringToBuffer,
  createTransactionChallenge,
  getSecp256r1MessageHash,
  type TransactionAuthDetails,
} from "@revibase/core";
import { getBase58Encoder } from "gill";
import type { ClientDataJSON, WellKnownCacheEntry } from "../types";

const WELL_KNOWN_CACHE_TTL_MS = 300_000;
const wellKnownPublicKeyCache = new Map<string, WellKnownCacheEntry>();

function bytesEqual(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function verifyEd25519Signature(
  base58Signature: string,
  messageHash: Uint8Array<ArrayBuffer>,
  base58PublicKey: string,
  errorMessage: string,
): Promise<void> {
  const signatureBytes = new Uint8Array(
    getBase58Encoder().encode(base58Signature),
  );
  const publicKeyBytes = new Uint8Array(
    getBase58Encoder().encode(base58PublicKey),
  );

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const isSignatureValid = await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    signatureBytes,
    messageHash,
  );

  if (!isSignatureValid) {
    throw new Error(errorMessage);
  }
}

export async function verifyAuthProviderSignature(
  authProviderSignature: { publicKey: string; signature: string } | undefined,
  messageHash: Uint8Array<ArrayBuffer>,
): Promise<void> {
  if (!authProviderSignature) return;

  await verifyEd25519Signature(
    authProviderSignature.signature,
    messageHash,
    authProviderSignature.publicKey,
    `Auth provider signature verification failed for auth provider ID: "${authProviderSignature.publicKey}".`,
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
    `Device signature verification failed for device ID: "${deviceSignature.publicKey}".`,
  );
}

async function fetchWellKnownClientPublicKey(
  clientOrigin: string,
  wellKnownProxyUrl?: URL,
): Promise<{ publicKey: JsonWebKey }> {
  const currentTimestamp = Date.now();
  const cachedEntry = wellKnownPublicKeyCache.get(clientOrigin);

  if (
    cachedEntry &&
    currentTimestamp - cachedEntry.timestamp < WELL_KNOWN_CACHE_TTL_MS
  ) {
    return { publicKey: cachedEntry.publicKey };
  }

  const fetchUrl = wellKnownProxyUrl
    ? `${wellKnownProxyUrl.origin}?origin=${encodeURIComponent(clientOrigin)}`
    : `${clientOrigin}/.well-known/revibase.json`;

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch .well-known/revibase.json for ${clientOrigin}`,
    );
  }

  const responseData = (await response.json()) as
    | { publicKey: JsonWebKey }
    | null
    | undefined;

  if (!responseData?.publicKey) {
    throw new Error(`Invalid .well-known response from ${clientOrigin}`);
  }

  wellKnownPublicKeyCache.set(clientOrigin, {
    publicKey: responseData.publicKey,
    timestamp: currentTimestamp,
  });

  return responseData;
}

export async function verifyClientSignature(
  clientSignature: { clientOrigin: string; signature: string },
  messageHash: Uint8Array<ArrayBuffer>,
  wellKnownProxyUrl?: URL,
): Promise<void> {
  const { publicKey: jwkPublicKey } = await fetchWellKnownClientPublicKey(
    clientSignature.clientOrigin,
    wellKnownProxyUrl,
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

  const isSignatureValid = await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    signatureBytes,
    new Uint8Array(messageHash),
  );

  if (!isSignatureValid) {
    throw new Error(
      `Client signature verification failed for client: "${clientSignature.clientOrigin}".`,
    );
  }
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

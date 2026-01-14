import { decodeCBOR, encodeCBOR, type CBORType } from "@levischuck/tiny-cbor";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import {
  address,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getU64Decoder,
  getUtf8Encoder,
  type Address,
} from "gill";
import { fetchDomainConfig } from "../../generated";
import {
  SignedSecp256r1Key,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartMessageRequest,
  type StartTransactionRequest,
  type TransactionAuthenticationResponse,
  type TransactionPayload,
  type TransactionPayloadWithBase64MessageBytes,
} from "../../types";
import { getDomainConfigAddress } from "../addresses";
import { getSolanaRpc } from "../initialize";
import {
  convertSignatureDERtoRS,
  extractAdditionalFields,
  getSecp256r1Message,
  parseOrigins,
  uint8ArrayToHex,
} from "./internal";

/**
 * Converts a COSE-encoded P-256 public key (from WebAuthn) into a compressed 33-byte key.
 *
 * The COSE format (RFC 8152) includes separate `x` and `y` coordinates. This function decodes
 * those coordinates, reconstructs the elliptic curve point, and re-encodes it into compressed format.
 *
 * @param publicKey - The COSE-encoded public key as a `Uint8Array` buffer.
 * @returns The compressed public key as a Base58-decoded `Uint8Array`.
 *
 * @example
 * const compressed = convertPubkeyCoseToCompressed(coseKey);
 */
export function convertPubkeyCoseToCompressed(
  publicKey: Uint8Array<ArrayBufferLike>
) {
  const decodedPublicKey = decodeCBOR(publicKey) as Map<number, CBORType>;
  const uncompressedPublicKey = p256.Point.fromAffine({
    x: BigInt("0x" + uint8ArrayToHex(decodedPublicKey.get(-2) as Uint8Array)),
    y: BigInt("0x" + uint8ArrayToHex(decodedPublicKey.get(-3) as Uint8Array)),
  });
  const compressedPubKey = getBase58Decoder().decode(
    uncompressedPublicKey.toBytes(true)
  );
  return compressedPubKey;
}

/**
 * Converts a compressed P-256 public key into COSE format for WebAuthn compatibility.
 *
 * This function decompresses the 33-byte public key, extracts `x` and `y` coordinates,
 * and encodes them into a COSE-structured CBOR map.
 *
 * @param publicKey - The compressed public key as a Base58 string.
 * @returns The COSE-encoded public key as a `Uint8Array`.
 *
 * @example
 * const coseKey = convertPubkeyCompressedToCose("2vMsnB7P5E7EwXj1LbcfLp...");
 */
export function convertPubkeyCompressedToCose(
  publicKey: string
): Uint8Array<ArrayBuffer> {
  const compressedPublicKey = p256.Point.fromBytes(
    new Uint8Array(getBase58Encoder().encode(publicKey))
  );
  const uncompressedPublicKey = compressedPublicKey.toBytes(false);

  const coseDecodedPublicKey = new Map<string | number, CBORType>();
  coseDecodedPublicKey.set(1, 2);
  coseDecodedPublicKey.set(3, -7);
  coseDecodedPublicKey.set(-1, 1);
  coseDecodedPublicKey.set(-2, uncompressedPublicKey.slice(1, 33));
  coseDecodedPublicKey.set(-3, uncompressedPublicKey.slice(33, 65));

  return new Uint8Array(encodeCBOR(coseDecodedPublicKey));
}

/**
 * Constructs a `SignedSecp256r1Key` object from a WebAuthn authentication response.
 *
 * This function extracts, validates, and converts all fields required for on-chain
 * secp256r1 signature verification, including:
 * - Converting signature format (DER → r||s)
 * - Extracting and truncating `clientDataJSON` to ensure deterministic hashing
 * - Computing the domain configuration address (via RP ID hash)
 *
 * Used as the main transformation step before submitting to Solana programs.
 *
 * @param payload - A `TransactionAuthenticationResponse` containing WebAuthn response data.
 * @param originIndex - The index of the origin that initiated the request (retrievable via `getOriginIndex`).
 * @param crossOrigin - Indicates whether the request originated from a different origin (per WebAuthn spec).
 * @returns A `SignedSecp256r1Key` ready for Solana transaction verification.
 *
 * @example
 * const signedKey = await getSignedSecp256r1Key(response, originIndex);
 */
export async function getSignedSecp256r1Key(
  payload: TransactionAuthenticationResponse
): Promise<SignedSecp256r1Key> {
  const { authenticatorData, clientDataJSON, signature } = (
    payload.authResponse as AuthenticationResponseJSON
  ).response;

  const authData = new Uint8Array(base64URLStringToBuffer(authenticatorData));

  const clientDataJsonParsed = JSON.parse(
    new TextDecoder().decode(base64URLStringToBuffer(clientDataJSON))
  ) as Record<string, any>;

  const truncatedClientDataJson = extractAdditionalFields(clientDataJsonParsed);

  const convertedSignature = convertSignatureDERtoRS(
    new Uint8Array(base64URLStringToBuffer(signature))
  );

  const domainConfig = await getDomainConfigAddress({
    rpIdHash: authData.subarray(0, 32),
  });

  return new SignedSecp256r1Key(payload.signer.toString(), {
    verifyArgs: {
      clientDataJson: new Uint8Array(base64URLStringToBuffer(clientDataJSON)),
      truncatedClientDataJson,
      slotNumber: BigInt(payload.slotNumber),
      slotHash: new Uint8Array(getBase58Encoder().encode(payload.slotHash)),
    },
    clientAndDeviceHash: getClientAndDeviceHash(
      payload.clientSignature.clientOrigin,
      payload.deviceSignature.publicKey,
      payload.nonce
    ),
    domainConfig,
    authData,
    signature: convertedSignature,
    originIndex: payload.originIndex,
    crossOrigin: payload.crossOrigin,
    authResponse: payload.authResponse,
  });
}

export async function getOriginIndex(domainConfig: Address, origin: string) {
  const { data } = await fetchDomainConfig(getSolanaRpc(), domainConfig);
  const origins = parseOrigins(new Uint8Array(data.origins), data.numOrigins);
  const index = origins.findIndex((x) => x === origin);
  if (index === -1) {
    throw new Error("Origin not found in domain config");
  }
  return index;
}

export function getClientAndDeviceHash(
  clientOrigin: string,
  devicePublicKey: string,
  nonce: string
) {
  return sha256(
    new Uint8Array([
      ...getUtf8Encoder().encode(clientOrigin),
      ...getBase58Encoder().encode(devicePublicKey),
      ...new TextEncoder().encode(nonce),
    ])
  );
}

export function createClientAuthorizationStartRequestChallenge(
  payload: StartTransactionRequest | StartMessageRequest
) {
  return sha256(
    new Uint8Array(getUtf8Encoder().encode(JSON.stringify(payload)))
  );
}

export function createClientAuthorizationCompleteRequestChallenge(
  payload: CompleteTransactionRequest | CompleteMessageRequest
) {
  return getSecp256r1MessageHash(payload.data.payload.authResponse);
}

export function createMessageChallenge(
  payload: string,
  clientOrigin: string,
  devicePublicKey: string,
  nonce: string
) {
  return sha256(
    new Uint8Array([
      ...getUtf8Encoder().encode(payload),
      ...getClientAndDeviceHash(clientOrigin, devicePublicKey, nonce),
    ])
  );
}

export async function createTransactionChallenge(
  payload: TransactionPayloadWithBase64MessageBytes | TransactionPayload,
  clientOrigin: string,
  devicePublicKey: string,
  nonce: string,
  slotHash?: string,
  slotNumber?: string
) {
  let slotHashBytes: Uint8Array;
  if (!slotHash || !slotNumber) {
    const slotSysvarData = (
      await getSolanaRpc()
        .getAccountInfo(
          address("SysvarS1otHashes111111111111111111111111111"),
          {
            encoding: "base64",
            commitment: "confirmed",
            dataSlice: { offset: 8, length: 40 },
          }
        )
        .send()
    ).value?.data;
    if (!slotSysvarData) {
      throw new Error("Unable to fetch slot sysvar");
    }
    const slotHashData = getBase64Encoder().encode(slotSysvarData[0]);
    slotNumber = getU64Decoder().decode(slotHashData.subarray(0, 8)).toString();
    slotHashBytes = slotHashData.subarray(8, 40);
    slotHash = getBase58Decoder().decode(slotHashBytes);
  } else {
    slotHashBytes = new Uint8Array(getBase58Encoder().encode(slotHash));
  }

  const challenge = sha256(
    new Uint8Array([
      ...getUtf8Encoder().encode(payload.transactionActionType),
      ...getBase58Encoder().encode(payload.transactionAddress),
      ...sha256(
        typeof payload.transactionMessageBytes === "string"
          ? new Uint8Array(
              base64URLStringToBuffer(payload.transactionMessageBytes)
            )
          : payload.transactionMessageBytes
      ),
      ...slotHashBytes,
      ...getClientAndDeviceHash(clientOrigin, devicePublicKey, nonce),
    ])
  );
  return { slotNumber, slotHash, challenge };
}

export function getSecp256r1MessageHash(
  authResponse: AuthenticationResponseJSON
) {
  return sha256(getSecp256r1Message(authResponse));
}

export function bufferToBase64URLString(buffer: Uint8Array) {
  let str = "";
  for (const charCode of buffer) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64URLStringToBuffer(base64URLString: string) {
  // Convert from Base64URL to Base64
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  /**
   * Pad with '=' until it's a multiple of four
   * (4 - (85 % 4 = 1) = 3) % 4 = 3 padding
   * (4 - (86 % 4 = 2) = 2) % 4 = 2 padding
   * (4 - (87 % 4 = 3) = 1) % 4 = 1 padding
   * (4 - (88 % 4 = 0) = 4) % 4 = 0 padding
   */
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  // Convert to a binary string
  const binary = atob(padded);
  // Convert binary string to buffer
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

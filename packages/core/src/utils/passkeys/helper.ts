import { decodeCBOR, encodeCBOR, type CBORType } from "@levischuck/tiny-cbor";
import { p256 } from "@noble/curves/p256";
import { equalBytes } from "@noble/curves/utils";
import { sha256 } from "@noble/hashes/sha2";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getUtf8Encoder,
  type Address,
} from "gill";
import { fetchDomainConfig } from "../../generated";
import {
  SignedSecp256r1Key,
  type TransactionAuthenticationResponse,
} from "../../types";
import { getDomainConfigAddress } from "../addresses";
import { getAuthEndpoint, getSolanaRpc } from "../initialize";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  extractAdditionalFields,
  parseOrigins,
  uint8ArrayToHex,
} from "./internal";

/**
 * Opens a popup window for WebAuthn or authentication workflows.
 *
 * This helper creates a centered, resizable popup on desktop, and a full-screen view on mobile.
 * It defaults to the `/loading` route of your configured authentication origin.
 *
 * @param url - The URL to load in the popup. Defaults to `https://auth.revibase.com/loading`.
 * @returns A reference to the newly created popup window, or `null` if blocked by the browser.
 *
 * @throws {Error} If called outside a browser environment.
 *
 */
export function createPopUp(url = `${getAuthEndpoint()}/loading`) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const screenWidth = window.innerWidth || screen.availWidth;
  const screenHeight = window.innerHeight || screen.availHeight;
  const isMobile = screenWidth <= 768;

  let width: number;
  let height: number;
  let top: number;
  let left: number;

  if (isMobile) {
    width = screenWidth;
    height = screenHeight;
    top = 0;
    left = 0;
  } else {
    const currentScreenLeft = window.screenLeft ?? window.screenX;
    const currentScreenTop = window.screenTop ?? window.screenY;
    const screenWidth =
      window.innerWidth ?? document.documentElement.clientWidth ?? screen.width;
    const screenHeight =
      window.innerHeight ??
      document.documentElement.clientHeight ??
      screen.height;
    width = 500;
    height = 600;
    left = currentScreenLeft + (screenWidth - width) / 2;
    top = currentScreenTop + (screenHeight - height) / 2;
  }

  const features = [
    `width=${width}`,
    `height=${height}`,
    `top=${top}`,
    `left=${left}`,
    `toolbar=no`,
    `location=no`,
    `status=no`,
    `menubar=no`,
    `scrollbars=yes`,
    `resizable=yes`,
  ].join(",");

  const passKeyPopup = window.open(url, "_blank", features);

  if (passKeyPopup) {
    passKeyPopup.focus();
  }

  return passKeyPopup;
}

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
  payload: TransactionAuthenticationResponse,
  originIndex = 0,
  crossOrigin = false
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
    requestedClientAndDeviceHash: sha256(
      new Uint8Array([
        ...new TextEncoder().encode(payload.requestedClient),
        ...getBase58Encoder().encode(payload.deviceSignature.publicKey),
      ])
    ),
    domainConfig,
    authData,
    signature: convertedSignature,
    originIndex,
    crossOrigin,
  });
}

export function verifyTransactionAuthResponseWithMessageHash(
  payload: TransactionAuthenticationResponse,
  expectedMessageHash: Uint8Array
) {
  const { authenticatorData, clientDataJSON } = (
    payload.authResponse as AuthenticationResponseJSON
  ).response;

  const authData = new Uint8Array(base64URLStringToBuffer(authenticatorData));

  const clientDataJsonParsed = JSON.parse(
    new TextDecoder().decode(base64URLStringToBuffer(clientDataJSON))
  ) as Record<string, any>;

  const { transactionActionType, transactionAddress, transactionMessageBytes } =
    payload.transactionPayload;

  const challenge = sha256(
    new Uint8Array([
      ...getUtf8Encoder().encode(transactionActionType),
      ...getAddressEncoder().encode(address(transactionAddress)),
      ...sha256(transactionMessageBytes),
      ...getBase58Encoder().encode(payload.slotHash),
      ...sha256(
        new Uint8Array([
          ...getUtf8Encoder().encode(payload.requestedClient),
          ...getBase58Encoder().encode(payload.deviceSignature.publicKey),
        ])
      ),
    ])
  );
  if (
    !equalBytes(
      new Uint8Array(
        base64URLStringToBuffer(clientDataJsonParsed["challenge"])
      ),
      challenge
    )
  )
    throw new Error("Invalid challenge");

  const messageHash = sha256(
    new Uint8Array([
      ...authData,
      ...sha256(new Uint8Array(base64URLStringToBuffer(clientDataJSON))),
    ])
  );

  if (!equalBytes(messageHash, expectedMessageHash))
    throw new Error("Invalid message hash");
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

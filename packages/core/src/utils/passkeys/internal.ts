import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { base64URLStringToBuffer } from "./helper";

export function uint8ArrayToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
export function extractAdditionalFields(
  clientData: Record<string, unknown>
): Uint8Array {
  const knownKeys = new Set(["type", "challenge", "origin", "crossOrigin"]);

  const remaining: Record<string, unknown> = {};
  for (const key in clientData) {
    if (!knownKeys.has(key)) {
      remaining[key] = clientData[key];
    }
  }

  if (Object.keys(remaining).length === 0) {
    return new Uint8Array([]);
  }

  // Serialize remaining fields
  const serialized = JSON.stringify(remaining);

  // Remove leading '{' and trailing '}' so it can be appended after a comma
  return new TextEncoder().encode(serialized.slice(1, -1));
}

export function parseOrigins(
  originsBytes: Uint8Array,
  numOrigins: number
): string[] {
  const origins: string[] = [];
  let cursor = 0;
  const decoder = new TextDecoder();

  for (let i = 0; i < numOrigins; i++) {
    if (cursor + 2 > originsBytes.length) {
      throw new Error("MaxLengthExceeded");
    }

    // Read 2-byte little-endian length
    const strLen = originsBytes[cursor] | (originsBytes[cursor + 1] << 8);
    cursor += 2;

    if (cursor + strLen > originsBytes.length) {
      throw new Error("MaxLengthExceeded");
    }

    const strBytes = originsBytes.slice(cursor, cursor + strLen);
    const origin = decoder.decode(strBytes);
    origins.push(origin);

    cursor += strLen;
  }

  return origins;
}
export function convertSignatureDERtoRS(signature: Uint8Array): Uint8Array {
  // already in compact format
  if (signature.length === 64) {
    return signature;
  }

  if (signature[0] !== 0x30) throw new Error("Invalid DER sequence");

  const totalLength = signature[1];
  let offset = 2;

  // Handle long-form length (uncommon, but DER allows it)
  if (totalLength > 0x80) {
    const lengthBytes = totalLength & 0x7f;
    offset += lengthBytes;
  }

  if (signature[offset] !== 0x02) throw new Error("Expected INTEGER for r");
  const rLen = signature[offset + 1];
  const rStart = offset + 2;
  const r = signature.slice(rStart, rStart + rLen);

  offset = rStart + rLen;
  if (signature[offset] !== 0x02) throw new Error("Expected INTEGER for s");
  const sLen = signature[offset + 1];
  const sStart = offset + 2;
  const s = signature.slice(sStart, sStart + sLen);

  // Strip any leading 0x00 padding from r/s if necessary
  const rStripped = r[0] === 0x00 && r.length > 32 ? r.slice(1) : r;
  const sStripped = s[0] === 0x00 && s.length > 32 ? s.slice(1) : s;

  if (rStripped.length > 32 || sStripped.length > 32) {
    throw new Error("r or s length > 32 bytes");
  }

  // Pad to 32 bytes
  const rPad = new Uint8Array(32);
  rPad.set(rStripped, 32 - rStripped.length);

  // Convert s to low-s
  const HALF_ORDER = p256.Point.CURVE().n >> 1n;
  const sBig = BigInt("0x" + uint8ArrayToHex(sStripped));
  const sLow = sBig > HALF_ORDER ? p256.Point.CURVE().n - sBig : sBig;
  const sHex = sLow.toString(16).padStart(64, "0");
  const sPad = hexToUint8Array(sHex);

  return new Uint8Array([...rPad, ...sPad]);
}

export function getSecp256r1Message(authResponse: AuthenticationResponseJSON) {
  return new Uint8Array([
    ...new Uint8Array(
      base64URLStringToBuffer(authResponse.response.authenticatorData)
    ),
    ...sha256(
      new Uint8Array(
        base64URLStringToBuffer(authResponse.response.clientDataJSON)
      )
    ),
  ]);
}

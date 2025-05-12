import { p256 } from "@noble/curves/p256";

/**
 * Converts bytes to a BigInt
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

/**
 * Converts a BigInt to a 32-byte big-endian Uint8Array
 */
export function bigintToBytes32(num: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  const hex = num.toString(16).padStart(64, "0");

  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

/**
 * Normalizes a signature to use the low S value
 */
export function normalizeSignatureToLowS(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) throw new Error("Signature must be 64 bytes");

  const r = sig.slice(0, 32);
  const s = sig.slice(32, 64);

  const rBig = bytesToBigInt(r);
  const sBig = bytesToBigInt(s);

  const n = p256.CURVE.n;
  const halfN = n / 2n;

  const lowS = sBig > halfN ? n - sBig : sBig;

  return new Uint8Array([...bigintToBytes32(rBig), ...bigintToBytes32(lowS)]);
}

/**
 * Converts a buffer to a base64 URL string
 */
export function bufferToBase64URLString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";

  for (const charCode of bytes) {
    str += String.fromCharCode(charCode);
  }

  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Generates a secp256r1 key pair for testing
 */
export function generateSecp256r1KeyPair() {
  const privateKey = p256.utils.randomPrivateKey();
  const publicKey = p256.getPublicKey(privateKey, true);
  return { privateKey, publicKey };
}

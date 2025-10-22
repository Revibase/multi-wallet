import { type CBORType, decodeCBOR, encodeCBOR } from "@levischuck/tiny-cbor";
import { p256 } from "@noble/curves/p256";
import { getBase58Decoder, getBase58Encoder } from "gill";
import { getAuthUrl } from "../initialize";
import { hexToUint8Array, uint8ArrayToHex } from "./internal";

export function createPopUp(url = `${getAuthUrl()}/loading`) {
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

export function convertSignatureDERtoRS(derSig: Uint8Array): Uint8Array {
  if (derSig[0] !== 0x30) throw new Error("Invalid DER sequence");

  const totalLength = derSig[1];
  let offset = 2;

  // Handle long-form length (uncommon, but DER allows it)
  if (totalLength > 0x80) {
    const lengthBytes = totalLength & 0x7f;
    offset += lengthBytes;
  }

  if (derSig[offset] !== 0x02) throw new Error("Expected INTEGER for r");
  const rLen = derSig[offset + 1];
  const rStart = offset + 2;
  const r = derSig.slice(rStart, rStart + rLen);

  offset = rStart + rLen;
  if (derSig[offset] !== 0x02) throw new Error("Expected INTEGER for s");
  const sLen = derSig[offset + 1];
  const sStart = offset + 2;
  const s = derSig.slice(sStart, sStart + sLen);

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

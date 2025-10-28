import { p256 } from "@noble/curves/p256";
import { Secp256r1Key } from "../../types";
import { createPopUp } from "./helper";

let activeMessageHandler: ((event: MessageEvent) => void) | null = null;
const HEARTBEAT_INTERVAL = 2000;
const TIMEOUT_BUFFER = 3000;
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

export async function openAuthUrl({
  authUrl,
  additionalInfo,
  signer,
  popUp = null,
  data,
}: {
  authUrl: string;
  additionalInfo?: any;
  data?: {
    type: "transaction" | "message";
    payload: string;
  };
  signer?: Secp256r1Key;
  popUp?: Window | null;
}) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }
  return new Promise((resolve, reject) => {
    const origin = new URL(authUrl).origin;

    let heartbeatTimeout: NodeJS.Timeout | null = null;

    const closeCheckInterval = setInterval(() => {
      if (popUp && popUp.closed) {
        cleanUp();
        reject(new Error("User closed the authentication window"));
      }
    }, 500);

    const globalTimeout = setTimeout(() => {
      log("Authentication timeout.");
      cleanUp();
      reject(new Error("Authentication timed out"));
    }, DEFAULT_TIMEOUT);

    function cleanUp() {
      clearInterval(closeCheckInterval);
      clearTimeout(globalTimeout);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      if (activeMessageHandler)
        window.removeEventListener("message", activeMessageHandler);
      if (popUp) popUp.close();
    }

    if (popUp) {
      popUp.location.replace(authUrl);
    } else {
      popUp = createPopUp(authUrl);
    }

    if (!popUp) {
      reject(new Error("Disable your popup blocker to continue."));
      return;
    }

    function log(...args: any[]) {
      if (additionalInfo?.debug) console.debug("[Popup]", ...args);
    }

    const messageReceivedHandler = (event: MessageEvent) => {
      const isSameOrigin = event.origin === origin;
      const isSameWindow = event.source === popUp;

      if (!isSameOrigin || !isSameWindow || !event.isTrusted || !popUp) {
        log("Ignored message from unknown source", event);
        return;
      }

      switch (event.data.type) {
        case "popup-ready":
          log("Popup is ready, sending auth data");
          popUp.postMessage(
            {
              type: "popup-init",
              payload: {
                signer: signer?.toString(),
                data,
                additionalInfo,
              },
            },
            origin
          );
          heartbeatTimeout = setTimeout(() => {
            cleanUp();
            reject(new Error("User closed the authentication window"));
          }, HEARTBEAT_INTERVAL + TIMEOUT_BUFFER);
          break;
        case "popup-complete":
          log("Received completion message");
          try {
            const payload = JSON.parse(event.data.payload as string);
            cleanUp();
            resolve(payload);
          } catch (error) {
            reject(new Error("Failed to parse response payload"));
          }
          break;
        case "popup-heartbeat":
          log("Received heartbeat");
          if (heartbeatTimeout) {
            clearTimeout(heartbeatTimeout);
            heartbeatTimeout = setTimeout(() => {
              cleanUp();
              reject(new Error("User closed the authentication window"));
            }, HEARTBEAT_INTERVAL + TIMEOUT_BUFFER);
          }
          break;

        case "popup-closed":
          log("Popup explicitly closed");
          cleanUp();
          reject(new Error("User closed the authentication window"));
          break;

        default:
          log("Unknown message type", event.data.type);
      }
    };

    if (activeMessageHandler) {
      window.removeEventListener("message", activeMessageHandler);
    }
    activeMessageHandler = messageReceivedHandler;
    window.addEventListener("message", activeMessageHandler);
  });
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
  clientData: Record<string, any>
): Uint8Array {
  const knownKeys = new Set(["type", "challenge", "origin", "crossOrigin"]);

  const remaining: Record<string, any> = {};
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

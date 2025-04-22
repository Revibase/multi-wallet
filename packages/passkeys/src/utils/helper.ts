import { CBORType, decodeCBOR, encodeCBOR } from "@levischuck/tiny-cbor";
import { p256 } from "@noble/curves/p256";
import { PublicKeyCredentialHint } from "@simplewebauthn/server";
import bs58 from "bs58";
import { closeAuthModal, createAuthIframe } from "./auth-iframe.js";
import { DEFAULT_AUTH_URL } from "./consts.js";
import { AuthenticationResponse, RegistrationResponse } from "./types.js";

let activeMessageHandler: ((event: MessageEvent) => void) | null = null;
const HEARTBEAT_INTERVAL = 2000;
const TIMEOUT_BUFFER = 3000;

export async function openAuthUrl({
  authUrl,
  hints,
  isRegister = false,
  message,
  publicKey,
  transaction,
  popUp = null,
  timeout = 2 * 60 * 1000, // 2 minutes default timeout
  debug = false,
}: {
  authUrl: string;
  hints?: PublicKeyCredentialHint[];
  isRegister?: boolean;
  message?: string;
  publicKey?: string;
  transaction?: string;
  popUp?: Window | null;
  timeout?: number;
  debug?: boolean;
}): Promise<AuthenticationResponse | RegistrationResponse> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  return new Promise((resolve, reject) => {
    const origin = new URL(authUrl).origin;
    const isIframeAllowed =
      !isRegister &&
      getBaseDomain(authUrl) === getBaseDomain(window.location.href);
    let source: Window | null = null;
    let heartbeatTimeout: NodeJS.Timeout | null = null;

    const closeCheckInterval = setInterval(() => {
      if (source && source.closed) {
        cleanUp();
        reject(new Error("User closed the authentication window"));
      }
    }, 500);

    const globalTimeout = setTimeout(() => {
      log("Global timeout reached.");
      cleanUp();
      reject(new Error("Authentication timed out"));
    }, timeout);

    function cleanUp() {
      clearInterval(closeCheckInterval);
      clearTimeout(globalTimeout);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      if (activeMessageHandler)
        window.removeEventListener("message", activeMessageHandler);
      if (source) source.close();
      if (isIframeAllowed) closeAuthModal();
    }

    if (isIframeAllowed) {
      if (popUp) popUp.close();
      source = createAuthIframe({
        authUrl,
        onClose: () => {
          cleanUp();
          reject(new Error("User closed the authentication window"));
        },
      });
      if (!source) {
        reject(new Error("An error occured while populating the iframe."));
        return;
      }
    } else {
      source = popUp;
      if (source) {
        source.location.replace(authUrl);
      } else {
        source = createPopUp(authUrl);
      }

      if (!source) {
        reject(new Error("Disable your popup blocker to continue."));
        return;
      }
    }

    function log(...args: any[]) {
      if (debug) console.debug("[Popup]", ...args);
    }

    const messageReceivedHandler = (event: MessageEvent) => {
      const isSameOrigin = event.origin === origin;
      const isSameWindow = event.source === source;

      if (!isSameOrigin || !isSameWindow || !event.isTrusted) {
        log("Ignored message from unknown source", event);
        return;
      }

      switch (event.data.type) {
        case "popup-ready":
          log("Popup is ready, sending auth data");
          source.postMessage(
            {
              type: "popup-init",
              payload: {
                message,
                publicKey,
                transaction,
                isRegister,
                hints,
              },
            },
            origin
          );
          heartbeatTimeout = setTimeout(() => {
            cleanUp();
            reject(new Error("User closed the authentication window"));
          }, HEARTBEAT_INTERVAL + TIMEOUT_BUFFER);
          break;

        case "popup-authentication-complete":
        case "popup-registration-complete":
          log("Received completion message");
          try {
            const payload = JSON.parse(event.data.payload);
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

export function createPopUp(authUrl = `${DEFAULT_AUTH_URL}/loading`) {
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

  const passKeyPopup = window.open(authUrl, "_blank", features);

  if (passKeyPopup) {
    passKeyPopup.focus();
  }

  return passKeyPopup;
}

export function convertPubkeyCoseToCompressed(
  publicKey: Uint8Array<ArrayBufferLike>
) {
  const decodedPublicKey = decodeCBOR(publicKey) as Map<number, CBORType>;
  const uncompressedPublicKey = p256.ProjectivePoint.fromAffine({
    x: BigInt("0x" + toHex(decodedPublicKey.get(-2) as Uint8Array)),
    y: BigInt("0x" + toHex(decodedPublicKey.get(-3) as Uint8Array)),
  });
  const compressedPubKey = bs58.encode(uncompressedPublicKey.toRawBytes(true));
  return compressedPubKey;
}

export function convertPubkeyCompressedToCose(publicKey: string) {
  const compressedPublicKey = p256.ProjectivePoint.fromHex(
    new Uint8Array(bs58.decode(publicKey))
  );
  const uncompressedPublicKey = compressedPublicKey.toRawBytes(false);

  const coseDecodedPublicKey = new Map<string | number, CBORType>();
  coseDecodedPublicKey.set(1, 2);
  coseDecodedPublicKey.set(3, -7);
  coseDecodedPublicKey.set(-1, 1);
  coseDecodedPublicKey.set(-2, uncompressedPublicKey.slice(1, 33));
  coseDecodedPublicKey.set(-3, uncompressedPublicKey.slice(33, 65));

  return encodeCBOR(coseDecodedPublicKey);
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
  const sPad = new Uint8Array(32);
  rPad.set(rStripped, 32 - rStripped.length);
  sPad.set(sStripped, 32 - sStripped.length);

  return new Uint8Array([...rPad, ...sPad]);
}

function toHex(array: Uint8Array) {
  const hexParts = Array.from(array, (i) => i.toString(16).padStart(2, "0"));
  return hexParts.join("");
}

function getBaseDomain(url: string): string {
  const { hostname } = new URL(url);
  const parts = hostname.split(".");

  if (parts.length > 2) {
    return parts.slice(parts.length - 2).join(".");
  }
  return hostname;
}

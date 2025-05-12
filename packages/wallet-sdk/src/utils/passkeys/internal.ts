import {
  AuthenticationResponseJSON,
  PublicKeyCredentialHint,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getProgramDerivedAddress } from "@solana/addresses";
import { getBase58Encoder } from "@solana/codecs";
import {
  getSecp256r1PubkeyDecoder,
  MULTI_WALLET_PROGRAM_ADDRESS,
} from "../../generated";
import { AuthenticationResponse, TransactionPayload } from "../../types";
import { convertSignatureDERtoRS, createPopUp } from "./helper";
import { closeAuthModal, createAuthIframe } from "./iframe";

let activeMessageHandler: ((event: MessageEvent) => void) | null = null;
const HEARTBEAT_INTERVAL = 2000;
const TIMEOUT_BUFFER = 3000;

export async function openAuthUrl({
  authUrl,
  additionalInfo,
  hints,
  isRegister = false,
  publicKey,
  popUp = null,
  timeout = 2 * 60 * 1000, // 2 minutes default timeout
  debug = false,
  data,
}: {
  authUrl: string;
  additionalInfo?: any;
  data?: {
    type: "transaction" | "message";
    payload: string;
  };
  hints?: PublicKeyCredentialHint[];
  isRegister?: boolean;
  publicKey?: string;
  popUp?: Window | null;
  timeout?: number;
  debug?: boolean;
}): Promise<AuthenticationResponse> {
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
                publicKey,
                isRegister,
                hints,
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

function getBaseDomain(url: string): string {
  const { hostname } = new URL(url);
  const parts = hostname.split(".");

  if (parts.length > 2) {
    return parts.slice(parts.length - 2).join(".");
  }
  return hostname;
}

export function convertTransactionPayload(payload: TransactionPayload) {
  return JSON.stringify({
    transactionActionType: payload.transactionActionType,
    transactionAddress: payload.transactionAddress.toString(),
    transactionMessageBytes: bufferToBase64URLString(
      payload.transactionMessageBytes
    ),
  });
}
export function bufferToBase64URLString(buffer: any) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const charCode of bytes) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
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

function base64URLStringToBuffer(base64URLString: string) {
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

export function isAuthenticationResponseJSON(
  response: AuthenticationResponseJSON | RegistrationResponseJSON
): response is AuthenticationResponseJSON {
  return "signature" in response.response;
}

export async function parseAuthenticationResponse(
  payload: AuthenticationResponse
) {
  if (!payload.slotNumber || !payload.slotHash) {
    throw new Error("Missing slot hash.");
  }

  const { authenticatorData, clientDataJSON, signature } = (
    payload.authResponse as AuthenticationResponseJSON
  ).response;

  const authData = new Uint8Array(base64URLStringToBuffer(authenticatorData));

  const clientDataJson = new Uint8Array(
    base64URLStringToBuffer(clientDataJSON)
  );

  const convertedSignature = convertSignatureDERtoRS(
    new Uint8Array(base64URLStringToBuffer(signature))
  );

  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      new TextEncoder().encode("domain_config"),
      authData.subarray(0, 32),
    ],
  });

  return {
    verifyArgs: {
      publicKey: getSecp256r1PubkeyDecoder().decode(
        getBase58Encoder().encode(payload.publicKey)
      ),
      clientDataJson: clientDataJson,
      slotNumber: BigInt(payload.slotNumber),
      slotHash: new Uint8Array(getBase58Encoder().encode(payload.slotHash)),
    },
    domainConfig,
    authData,
    signature: convertedSignature,
  };
}

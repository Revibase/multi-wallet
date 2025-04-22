import { PublicKeyCredentialHint } from "@simplewebauthn/server";
import { address, getProgramDerivedAddress } from "@solana/addresses";
import bs58 from "bs58";
import {
  AuthenticationResponse,
  convertSignatureDERtoRS,
  DEFAULT_AUTH_URL,
  openAuthUrl,
  TransactionActionType,
} from "./utils";

export async function signTransaction({
  transactionActionType,
  transactionAddress,
  transactionMessageBytes,
  authUrl = DEFAULT_AUTH_URL,
  hints,
  publicKey,
  popUp,
  debug,
}: {
  transactionActionType: TransactionActionType;
  transactionAddress: string;
  transactionMessageBytes: Uint8Array;
  hints?: PublicKeyCredentialHint[];
  authUrl?: string;
  publicKey?: string;
  popUp?: Window | null;
  debug?: boolean;
}) {
  const authResponse = (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    transaction: JSON.stringify({
      transactionActionType,
      transactionAddress: transactionAddress.toString(),
      transactionMessageBytes: bufferToBase64URLString(transactionMessageBytes),
    }),
    publicKey,
    popUp,
    debug,
    hints,
  })) as AuthenticationResponse;

  if (!authResponse.slotNumber || !authResponse.slotHash) {
    throw new Error("Missing slot hash.");
  }

  const authData = new Uint8Array(
    base64URLStringToBuffer(authResponse.response.authenticatorData)
  );

  const clientDataJson = new Uint8Array(
    base64URLStringToBuffer(authResponse.response.clientDataJSON)
  );

  const signature = convertSignatureDERtoRS(
    new Uint8Array(base64URLStringToBuffer(authResponse.response.signature))
  );

  const truncatedAuthData = authData.subarray(32, authData.length);

  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: address("HomqiGa9FxngxAPbVEFzXM3pjicY5RbGCBu3dVNui3ry"),
    seeds: [
      new TextEncoder().encode("domain_config"),
      authData.subarray(0, 32),
    ],
  });

  return {
    verifyArgs: {
      signature,
      pubkey: bs58.decode(authResponse.publicKey),
      truncatedAuthData,
      clientDataJson,
      slotNumber: BigInt(authResponse.slotNumber),
      slotHash: bs58.decode(authResponse.slotHash),
    },
    domainConfig: domainConfig.toString(),
  };
}

function bufferToBase64URLString(buffer: any) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const charCode of bytes) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
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

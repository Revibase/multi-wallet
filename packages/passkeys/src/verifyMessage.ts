import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  AuthenticationResponse,
  convertPubkeyCompressedToCose,
  DEFAULT_AUTH_URL,
  DEFAULT_RP_ID,
} from "./utils";

export async function verifyMessage({
  message,
  response,
  expectedOrigin = DEFAULT_AUTH_URL,
  expectedRPID = DEFAULT_RP_ID,
}: {
  message: string;
  response: AuthenticationResponse;
  expectedOrigin?: string;
  expectedRPID?: string;
}): Promise<boolean> {
  const publicKey = convertPubkeyCompressedToCose(response.publicKey);
  const { verified } = await verifyAuthenticationResponse({
    response,
    expectedChallenge: bufferToBase64URLString(
      new TextEncoder().encode(message)
    ),
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
    credential: {
      id: response.id,
      publicKey,
      counter: 0,
    },
  });

  return verified;
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

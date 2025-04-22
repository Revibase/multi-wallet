import { PublicKeyCredentialHint } from "@simplewebauthn/server";
import { AuthenticationResponse, DEFAULT_AUTH_URL, openAuthUrl } from "./utils";

export async function signMessage({
  message,
  authUrl = DEFAULT_AUTH_URL,
  publicKey,
  popUp,
  hints,
  debug,
}: {
  message: string;
  authUrl?: string;
  hints?: PublicKeyCredentialHint[];
  popUp?: Window | null;
  publicKey?: string;
  debug?: boolean;
}) {
  return (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    message,
    publicKey,
    popUp,
    debug,
    hints,
  })) as AuthenticationResponse;
}

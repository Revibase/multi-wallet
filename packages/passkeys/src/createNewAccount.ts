import { PublicKeyCredentialHint } from "@simplewebauthn/server";
import { DEFAULT_AUTH_URL, openAuthUrl, RegistrationResponse } from "./utils";

export async function createNewAccount({
  authUrl = DEFAULT_AUTH_URL,
  hints,
  popUp,
  debug,
}: {
  hints?: PublicKeyCredentialHint[];
  authUrl?: string;
  popUp?: Window | null;
  debug?: boolean;
}) {
  return (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    isRegister: true,
    popUp,
    debug,
    hints,
  })) as RegistrationResponse;
}

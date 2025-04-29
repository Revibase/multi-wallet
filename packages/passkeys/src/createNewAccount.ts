import { BasePayload, DEFAULT_AUTH_URL, RegistrationResponse } from "./utils";
import { openAuthUrl } from "./utils/internal";

export async function createNewAccount({
  authUrl = DEFAULT_AUTH_URL,
  hints,
  popUp,
  debug,
  additionalInfo,
}: BasePayload) {
  return (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    isRegister: true,
    popUp,
    debug,
    hints,
    additionalInfo,
  })) as RegistrationResponse;
}

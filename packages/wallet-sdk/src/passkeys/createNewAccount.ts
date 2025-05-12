import { BasePayload } from "../types";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function createNewAccount({
  authUrl = "https://auth.revibase.com",
  hints,
  popUp,
  debug,
  additionalInfo,
}: BasePayload) {
  return await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    isRegister: true,
    popUp,
    debug,
    hints,
    additionalInfo,
  });
}

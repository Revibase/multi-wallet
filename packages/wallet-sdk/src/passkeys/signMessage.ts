import { AuthenticationResponse, BasePayload, MessagePayload } from "../types";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessage({
  message,
  authUrl = "https://auth.revibase.com",
  publicKey,
  popUp,
  hints,
  debug,
  additionalInfo,
}: MessagePayload & BasePayload) {
  return (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    data: { type: "message", payload: message },
    publicKey,
    popUp,
    debug,
    hints,
    additionalInfo,
  })) as AuthenticationResponse;
}

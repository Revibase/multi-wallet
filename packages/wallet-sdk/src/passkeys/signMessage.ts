import { AuthenticationResponse, BasePayload, MessagePayload } from "../types";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessage({
  authUrl = "https://auth.revibase.com",
  message,
  credentialId,
  transports,
  popUp,
  hints,
  debug,
  additionalInfo,
}: MessagePayload & BasePayload) {
  return (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    data: { type: "message", payload: message },
    credentialId,
    transports,
    popUp,
    debug,
    hints,
    additionalInfo,
  })) as AuthenticationResponse;
}

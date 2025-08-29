import {
  BasePayload,
  MessageAuthenticationResponse,
  MessagePayload,
} from "../types";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessage({
  authUrl = "https://auth.revibase.com",
  message,
  signer,
  popUp,
  hints,
  debug,
  additionalInfo,
}: MessagePayload & BasePayload) {
  return (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    data: { type: "message", payload: message },
    signer,
    popUp,
    debug,
    hints,
    additionalInfo,
  })) as MessageAuthenticationResponse;
}

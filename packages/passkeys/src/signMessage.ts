import {
  AuthenticationResponse,
  BasePayload,
  DEFAULT_AUTH_URL,
  MessagePayload,
} from "./utils";
import { openAuthUrl } from "./utils/internal";

export async function signMessage({
  message,
  authUrl = DEFAULT_AUTH_URL,
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

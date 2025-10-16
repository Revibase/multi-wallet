import type {
  BasePayload,
  MessageAuthenticationResponse,
  MessagePayload,
} from "../types";
import { getAuthUrl, getGlobalAdditonalInfo } from "../utils";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessage({
  authUrl = getAuthUrl(),
  message,
  signer,
  popUp,
  hints,
  debug,
  additionalInfo = getGlobalAdditonalInfo(),
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

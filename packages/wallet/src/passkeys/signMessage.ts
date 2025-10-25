import {
  Secp256r1Key,
  type BasePayload,
  type MessageAuthenticationResponse,
  type MessagePayload,
} from "../types";
import { getAuthUrl, getGlobalAdditonalInfo } from "../utils";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessageWithPasskey({
  authUrl = getAuthUrl(),
  message,
  signer,
  popUp,
  hints,
  debug,
  additionalInfo = getGlobalAdditonalInfo(),
}: MessagePayload & BasePayload) {
  const authResponse = (await openAuthUrl({
    authUrl: `${authUrl}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    data: { type: "message", payload: message },
    signer,
    popUp,
    debug,
    hints,
    additionalInfo,
  })) as any;
  return {
    ...authResponse,
    signer: new Secp256r1Key(authResponse.signer),
  } as MessageAuthenticationResponse;
}

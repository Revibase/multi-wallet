import {
  Secp256r1Key,
  type BasePayload,
  type MessageAuthenticationResponse,
  type MessagePayload,
} from "../types";
import { getAuthEndpoint, getGlobalAdditonalInfo } from "../utils";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessageWithPasskey({
  message,
  signer,
  popUp,
}: MessagePayload & BasePayload) {
  const authResponse = (await openAuthUrl({
    authUrl: `${getAuthEndpoint()}/?redirectUrl=${encodeURIComponent(window.origin)}`,
    data: { type: "message", payload: message },
    signer,
    popUp,
    additionalInfo: getGlobalAdditonalInfo(),
  })) as any;
  return {
    ...authResponse,
    signer: new Secp256r1Key(authResponse.signer),
  } as MessageAuthenticationResponse;
}

import { getBase64Decoder } from "gill";
import {
  Secp256r1Key,
  type BasePayload,
  type MessageAuthenticationResponse,
  type MessagePayload,
} from "../types";
import { getAuthEndpoint, getClientSettings } from "../utils";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessageWithPasskey({
  message,
  signer,
  popUp,
}: MessagePayload & BasePayload) {
  const { clientId, signClientMessage } = getClientSettings();
  const data = { type: "message" as const, payload: message };
  const payload = getBase64Decoder().decode(
    new Uint8Array([
      ...new TextEncoder().encode(JSON.stringify(data)),
      ...(signer ? signer.toBuffer() : []),
    ])
  );
  const { signature, expiry } = await signClientMessage("start", payload);
  const authUrl =
    `${getAuthEndpoint()}/?` +
    `redirectUrl=${encodeURIComponent(window.origin)}` +
    `&clientId=${encodeURIComponent(clientId)}` +
    `&signature=${encodeURIComponent(signature)}` +
    `&expiry=${encodeURIComponent(expiry)}`;

  const authResponse = (await openAuthUrl({
    authUrl,
    data,
    signer,
    popUp,
  })) as any;
  return {
    ...authResponse,
    signer: new Secp256r1Key(authResponse.signer),
  } as MessageAuthenticationResponse;
}

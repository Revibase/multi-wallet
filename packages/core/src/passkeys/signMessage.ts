import {
  Secp256r1Key,
  type BasePayload,
  type MessageAuthenticationResponse,
  type MessagePayload,
} from "../types";
import {
  getAuthEndpoint,
  getClientMessageHash,
  getClientSettings,
} from "../utils";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessageWithPasskey({
  message,
  signer,
  popUp,
}: MessagePayload & BasePayload) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }
  const { clientId, signClientMessage } = getClientSettings();
  const data = { type: "message" as const, payload: message };
  const redirectUrl = window.origin;
  const clientMessageHash = getClientMessageHash(
    data,
    clientId,
    redirectUrl,
    signer?.toString()
  );
  const { signature, expiry } = await signClientMessage(
    "start",
    clientMessageHash
  );
  const authUrl =
    `${getAuthEndpoint()}/?` +
    `redirectUrl=${encodeURIComponent(redirectUrl)}` +
    `&clientId=${encodeURIComponent(clientId)}` +
    `&signature=${encodeURIComponent(signature)}` +
    `&expiry=${encodeURIComponent(expiry)}` +
    `&messageHash=${encodeURIComponent(clientMessageHash)}`;

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

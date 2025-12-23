import {
  type BasePayload,
  type ClientAuthorizationCompleteRequest,
  type ClientAuthorizationStartRequest,
  type MessageAuthenticationResponse,
  type MessagePayload,
} from "@revibase/core";
import { createPopUp } from "./helper";
import { openAuthUrl } from "./internal";

export async function signMessageWithPasskey({
  id,
  message,
  signer,
  popUp,
  authOrigin,
  onClientAuthorizationCallback,
}: MessagePayload & BasePayload): Promise<MessageAuthenticationResponse> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const redirectOrigin = window.origin;
  const authUrl = `${authOrigin}?redirectOrigin=${redirectOrigin}`;

  const payload: ClientAuthorizationStartRequest = {
    phase: "start",
    data: { id, type: "message" as const, payload: message },
    redirectOrigin,
    signer,
  };
  const [popupWindow, initialSignature] = await Promise.all([
    Promise.resolve(popUp ?? createPopUp(authUrl)),
    onClientAuthorizationCallback(payload),
  ]);

  const response = (await openAuthUrl({
    authUrl,
    payload,
    signature: initialSignature,
    popUp: popupWindow,
  })) as ClientAuthorizationCompleteRequest;

  if (response.data.type !== "message") {
    throw new Error("Expected Message Response");
  }

  const finalSignature = await onClientAuthorizationCallback(response);

  return {
    ...response.data.payload,
    clientSignature: {
      ...response.data.payload.clientSignature,
      signature: finalSignature,
    },
  };
}

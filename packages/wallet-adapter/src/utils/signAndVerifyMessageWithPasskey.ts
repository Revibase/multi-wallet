import type {
  CompleteMessageRequest,
  StartMessageRequest,
} from "@revibase/core";
import { type BasePayload, type MessagePayload } from "@revibase/core";
import { createPopUp } from "./helper";
import { openAuthUrl } from "./internal";
import type { ClientAuthorizationCallback } from "./types";

export async function signAndVerifyMessageWithPasskey({
  message,
  signer,
  popUp,
  authOrigin,
  onClientAuthorizationCallback,
}: MessagePayload &
  BasePayload & {
    onClientAuthorizationCallback: ClientAuthorizationCallback;
  }) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const redirectOrigin = window.origin;
  const authUrl = `${authOrigin}?redirectOrigin=${redirectOrigin}`;

  const payload: StartMessageRequest = {
    phase: "start",
    data: { type: "message" as const, payload: message },
    redirectOrigin,
    signer,
  };
  const [popupWindow, { message: initialMessage, id, signature }] =
    await Promise.all([
      Promise.resolve(popUp ?? createPopUp(authUrl)),
      onClientAuthorizationCallback(payload),
    ]);

  const response = (await openAuthUrl({
    authUrl,
    payload: {
      ...payload,
      data: { ...payload.data, payload: initialMessage },
    },
    signature,
    popUp: popupWindow,
  })) as CompleteMessageRequest;

  if (response.data.type !== "message") {
    throw new Error("Expected Message Response");
  }

  return await onClientAuthorizationCallback({
    ...response,
    data: {
      ...response.data,
      payload: { ...response.data.payload, id, message: initialMessage },
    },
  });
}

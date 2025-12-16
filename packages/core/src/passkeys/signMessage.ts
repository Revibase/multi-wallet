import {
  type BasePayload,
  type ClientAuthorizationCompleteRequest,
  type ClientAuthorizationStartRequest,
  type MessageAuthenticationResponse,
  type MessagePayload,
} from "../types";
import { getAuthEndpoint, getOnClientAuthorizationCallback } from "../utils";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessageWithPasskey({
  id,
  message,
  signer,
  popUp,
}: MessagePayload & BasePayload): Promise<MessageAuthenticationResponse> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }
  const redirectOrigin = window.origin;
  const payload: ClientAuthorizationStartRequest = {
    phase: "start",
    data: { type: "message" as const, payload: message },
    redirectOrigin,
    signer,
  };
  const signature = await getOnClientAuthorizationCallback()(payload);
  const response = (await openAuthUrl({
    authUrl: `${getAuthEndpoint()}?redirectOrigin=${redirectOrigin}`,
    payload,
    signature,
    popUp,
  })) as ClientAuthorizationCompleteRequest;
  if (response.data.type !== "message") {
    throw new Error("Expected Message Response");
  }
  return {
    ...response.data.payload,
    clientSignature: {
      ...response.data.payload.clientSignature,
      signature: await getOnClientAuthorizationCallback()({
        ...response,
        data: { ...response.data, id },
      }),
    },
  };
}

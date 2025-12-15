import { type BasePayload, type MessagePayload } from "../types";
import { getAuthEndpoint, getOnClientAuthorizationCallback } from "../utils";
import { openAuthUrl } from "../utils/passkeys/internal";

export async function signMessageWithPasskey({
  message,
  signer,
  popUp,
}: MessagePayload & BasePayload) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }
  const redirectOrigin = window.origin;
  const data = { type: "message" as const, payload: message };
  const sessionToken = await getOnClientAuthorizationCallback()({
    phase: "start",
    data,
    redirectOrigin,
    signer,
  });
  await openAuthUrl({
    authUrl: `${getAuthEndpoint()}&sessionToken=${sessionToken}`,
    popUp,
  });
  const result = await getOnClientAuthorizationCallback()({
    phase: "complete",
    data: {
      type: "message",
      sessionToken,
    },
  });
  return result;
}

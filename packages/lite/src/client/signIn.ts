import type {
  CompleteMessageRequest,
  StartMessageRequest,
} from "@revibase/core";
import type { RevibaseProvider } from "src/provider/main";
import type { User } from "src/utils";

export async function signIn(
  provider: RevibaseProvider
): Promise<{ user: User }> {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }
  provider.openBlankPopUp();

  const redirectOrigin = window.origin;
  const payload: StartMessageRequest = {
    phase: "start",
    data: { type: "message" as const },
    redirectOrigin,
  };

  const { signature, message, id } =
    await provider.onClientAuthorizationCallback(payload);

  const response = (await provider.sendPayloadToProvider({
    payload: {
      ...payload,
      data: { ...payload.data, payload: message },
    },
    signature,
  })) as CompleteMessageRequest;

  return await provider.onClientAuthorizationCallback({
    ...response,
    data: {
      ...response.data,
      payload: { ...response.data.payload, id, message },
    },
  });
}

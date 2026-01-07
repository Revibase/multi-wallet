import type {
  CompleteMessageRequest,
  StartMessageRequest,
} from "@revibase/core";
import type { RevibaseProvider } from "src/provider";

export async function signAndVerifyMessageWithPasskey({
  message,
  signer,
  provider,
}: {
  message?: string;
  signer?: string;
  provider: RevibaseProvider;
}) {
  provider.openBlankPopUp();
  const redirectOrigin = window.origin;
  const payload: StartMessageRequest = {
    phase: "start",
    data: { type: "message" as const, payload: message },
    redirectOrigin,
    signer,
  };

  const {
    signature,
    message: initialMessage,
    id,
  } = await provider.onClientAuthorizationCallback(payload);

  const response = (await provider.sendPayloadToProvider({
    payload: {
      ...payload,
      data: { ...payload.data, payload: initialMessage },
    },
    signature,
  })) as CompleteMessageRequest;

  return await provider.onClientAuthorizationCallback({
    ...response,
    data: {
      ...response.data,
      payload: { ...response.data.payload, id, message: initialMessage },
    },
  });
}

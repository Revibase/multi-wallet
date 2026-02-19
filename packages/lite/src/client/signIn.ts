import type { StartMessageRequest, UserInfo } from "@revibase/core";
import { getBase64Decoder } from "gill";
import type { RevibaseProvider } from "src/provider/main";
import { DEFAULT_TIMEOUT } from "src/provider/utils";
import { createSignInMessageText } from "src/utils/internal";

export async function signIn(
  provider: RevibaseProvider,
): Promise<{ user: UserInfo }> {
  const { rid, redirectOrigin } = provider.initialize();

  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const payload: StartMessageRequest = {
    phase: "start",
    rid,
    validTill: Date.now() + DEFAULT_TIMEOUT,
    data: {
      type: "message" as const,
      payload: createSignInMessageText({
        domain: redirectOrigin,
        nonce: getBase64Decoder().decode(
          crypto.getRandomValues(new Uint8Array(16)),
        ),
      }),
    },
    redirectOrigin,
  };

  const abortController = new AbortController();
  if (!provider.channelId) {
    provider
      .sendPayloadToProvider({
        rid,
        signal: abortController.signal,
      })
      .catch((error) => abortController.abort(error));
  }
  return await provider.onClientAuthorizationCallback(
    payload,
    abortController.signal,
    await provider.getDeviceSignature(),
    provider.channelId,
  );
}

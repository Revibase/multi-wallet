import type { CompleteMessageRequest, UserInfo } from "@revibase/core";
import { getBase64Decoder } from "gill";
import { RevibaseProvider } from "src/provider/main";
import { createSignInMessageText } from "src/utils/internal";
import { withRetry } from "src/utils/retry";
import type { SignInAuthorizationFlowOptions } from "src/utils/types";

/** Opens auth popup (or channel when options.channelId). Returns user after passkey auth. Options: signal?, channelId?. */
export async function signIn(
  provider: RevibaseProvider,
  options?: SignInAuthorizationFlowOptions,
): Promise<{ user: UserInfo }> {
  const onConnectedCallback = async (rid: string, clientOrigin: string) => {
    const payload = {
      phase: "start" as const,
      rid,
      data: {
        type: "message" as const,
        payload: createSignInMessageText({
          domain: clientOrigin,
          nonce: getBase64Decoder().decode(
            crypto.getRandomValues(new Uint8Array(16)),
          ),
        }),
      },
      clientOrigin,
    };

    const { signature, validTill } = await withRetry(() =>
      provider.onClientAuthorizationCallback(payload),
    );
    return { request: { ...payload, rid, validTill }, signature };
  };

  const onSuccessCallback = async (
    result: CompleteMessageRequest,
  ): Promise<{ user: UserInfo }> => {
    return provider.onClientAuthorizationCallback(result);
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}

import {
  UserInfoSchema,
  type CompleteMessageRequest,
  type UserInfo,
} from "@revibase/core";
import { getBase64Decoder } from "gill";
import { RevibaseProvider } from "../provider/main";
import { createSignInMessageText } from "../utils/internal";
import { send2FARequestIfNeeded } from "../utils/message";
import { withRetry } from "../utils/retry";
import type { SignInAuthorizationFlowOptions } from "../utils/types";

/** Opens auth popup (or channel when options.channelId). Returns user after passkey auth. Options: signal?, channelId?. */
export async function signIn(
  provider: RevibaseProvider,
  options?: SignInAuthorizationFlowOptions,
): Promise<{ user: UserInfo }> {
  const onConnectedCallback = async (rid: string, clientOrigin: string) => {
    const payload = {
      phase: "start" as const,
      rid,
      providerOrigin: provider.providerOrigin,
      rpId: provider.rpId,
      data: {
        type: "message" as const,
        payload: createSignInMessageText({
          domain: clientOrigin,
          nonce: getBase64Decoder().decode(
            crypto.getRandomValues(new Uint8Array(16)),
          ),
        }),
        requireTwoFactorAuthentication:
          options?.requireTwoFactorAuthentication ?? false,
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
    const user = UserInfoSchema.parse(result.data.payload.additionalInfo);
    const transactionManager = await send2FARequestIfNeeded(
      user,
      result,
      options,
    );
    await provider.onClientAuthorizationCallback(
      !transactionManager
        ? result
        : {
            ...result,
            data: {
              ...result.data,
              payload: { ...result.data.payload, transactionManager },
            },
          },
    );
    return { user };
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}

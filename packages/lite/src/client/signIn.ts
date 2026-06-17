import { type CompleteMessageRequest, type UserInfo } from "@revibase/core";
import { getBase64Decoder } from "@solana/kit";
import { RevibaseProvider } from "../provider/main";
import { createSignInMessageText } from "../utils/internal";
import { send2FARequestIfNeeded } from "../utils/message";
import { withRetry } from "../utils/retry";
import type {
  OnSuccessContext,
  SignInAuthorizationFlowOptions,
} from "../utils/types";

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
    { reportStatus, signal }: OnSuccessContext,
  ): Promise<{ user: UserInfo }> => {
    const transactionManager = await send2FARequestIfNeeded(result, {
      ...options,
      signal,
      reportStatus,
    });
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
    return { user: result.data.payload.user };
  };

  return provider.sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal: options?.signal,
  });
}

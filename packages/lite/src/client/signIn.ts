
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import { signAndVerifyMessageWithPasskey } from "src/utils/signAndVerifyMessageWithPasskey";
import type { ClientAuthorizationCallback } from "src/utils/types";

export async function signIn(
  onClientAuthorizationCallback: ClientAuthorizationCallback,
  authOrigin?: string
) {
  return signAndVerifyMessageWithPasskey({
    authOrigin: authOrigin ?? REVIBASE_AUTH_URL,
    onClientAuthorizationCallback,
  });
}

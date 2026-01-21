import {
  createClientAuthorizationStartRequestChallenge,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import { getBase58Decoder } from "gill";
import { REVIBASE_AUTH_URL } from "src/utils/consts";

export async function processStartRequest({
  privateKey,
  request,
  providerOrigin = REVIBASE_AUTH_URL,
}: {
  privateKey: CryptoKey;
  request: StartTransactionRequest | StartMessageRequest;
  providerOrigin?: string;
}): Promise<{ rid: string }> {
  const challenge = createClientAuthorizationStartRequestChallenge(request);
  const signature = getBase58Decoder().decode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        new Uint8Array(challenge),
      ),
    ),
  );
  const res = await fetch(`${providerOrigin}/startRequest`, {
    method: "POST",
    body: JSON.stringify({
      signature,
      request,
    }),
  });

  if (!res.ok) {
    throw new Error(((await res.json()) as { error: string }).error);
  }
  return (await res.json()) as { rid: string };
}

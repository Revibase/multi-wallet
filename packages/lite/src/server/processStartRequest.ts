import {
  convertBase64StringToJWK,
  createClientAuthorizationStartRequestChallenge,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import { CompactSign } from "jose";
import { REVIBASE_AUTH_URL } from "src/utils/consts";

export async function processStartRequest({
  privateKey,
  request,
  providerOrigin = REVIBASE_AUTH_URL,
  signal,
}: {
  privateKey: string;
  request: StartTransactionRequest | StartMessageRequest;
  providerOrigin?: string;
  signal: AbortSignal;
}): Promise<{ rid: string }> {
  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationStartRequestChallenge(request),
  )
    .setProtectedHeader({
      alg: pKey.alg,
    })
    .sign(pKey);

  const res = await fetch(`${providerOrigin}/api/startRequest`, {
    method: "POST",
    body: JSON.stringify({
      signature,
      request,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(((await res.json()) as { error: string }).error);
  }
  return (await res.json()) as { rid: string };
}

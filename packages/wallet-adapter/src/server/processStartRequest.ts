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
}: {
  privateKey: string;
  request: StartTransactionRequest | StartMessageRequest;
  providerOrigin?: string;
}): Promise<{ rid: string }> {
  const pkey = convertBase64StringToJWK(privateKey);
  if (!pkey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    createClientAuthorizationStartRequestChallenge(request),
  )
    .setProtectedHeader({
      alg: pkey.alg,
    })
    .sign(pkey);
  const res = await fetch(`${providerOrigin}/api/startRequest`, {
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

import {
  convertBase64StringToJWK,
  createClientAuthorizationStartRequestChallenge,
  type CompleteMessageRequest,
  type CompleteSendTransactionRequest,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/core";
import { CompactSign } from "jose";
import { REVIBASE_AUTH_URL } from "src/utils/consts";

export async function startRequest({
  privateKey,
  request,
  providerOrigin = REVIBASE_AUTH_URL,
  signal,
  device,
  channelId,
}: {
  privateKey: string;
  request: StartTransactionRequest | StartMessageRequest;
  signal: AbortSignal;
  channelId?: string;
  device?: {
    jwk: string;
    jws: string;
  };
  providerOrigin?: string;
}) {
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
      device,
      channelId,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(((await res.json()) as { error: string }).error);
  }
  return (await res.json()) as
    | CompleteMessageRequest
    | CompleteSendTransactionRequest;
}

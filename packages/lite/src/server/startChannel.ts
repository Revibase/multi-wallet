import { convertBase64StringToJWK } from "@revibase/core";
import { CompactSign } from "jose";
import type { StartChannelRequest } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";

export async function startChannel({
  privateKey,
  request,
  providerOrigin = REVIBASE_AUTH_URL,
  signal,
}: {
  privateKey: string;
  request: StartChannelRequest;
  signal?: AbortSignal;
  providerOrigin?: string;
}) {
  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    new TextEncoder().encode(request.data.channelId),
  )
    .setProtectedHeader({
      alg: pKey.alg,
    })
    .sign(pKey);

  const res = await fetch(`${providerOrigin}/api/startChannel`, {
    method: "POST",
    body: JSON.stringify({
      signature,
      clientOrigin: request.redirectOrigin,
      device: request.data.device,
      channelId: request.data.channelId,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(((await res.json()) as { error: string }).error);
  }
}

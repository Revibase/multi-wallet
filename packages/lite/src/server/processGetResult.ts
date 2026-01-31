import {
  convertBase64StringToJWK,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
} from "@revibase/core";
import { getBase64Encoder } from "gill";
import { CompactSign } from "jose";
import { REVIBASE_AUTH_URL } from "src/utils/consts";

export async function processGetResult({
  rid,
  privateKey,
  providerOrigin = REVIBASE_AUTH_URL,
}: {
  rid: string;
  privateKey: string;
  providerOrigin?: string;
}): Promise<CompleteMessageRequest | CompleteTransactionRequest> {
  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");
  const signature = await new CompactSign(
    getBase64Encoder().encode(rid) as Uint8Array,
  )
    .setProtectedHeader({
      alg: pKey.alg,
    })
    .sign(pKey);

  const res = await fetch(`${providerOrigin}/api/getResult`, {
    method: "POST",
    body: JSON.stringify({ rid, signature }),
  });

  if (!res.ok) {
    throw new Error(((await res.json()) as { error: string }).error);
  }
  return (await res.json()) as
    | CompleteMessageRequest
    | CompleteTransactionRequest;
}

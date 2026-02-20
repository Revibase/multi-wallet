import type {
  CompleteMessageRequest,
  CompleteSendTransactionRequest,
} from "@revibase/core";
import { convertBase64StringToJWK } from "@revibase/core";
import { getBase64Encoder } from "gill";
import { CompactSign } from "jose";
import { REVIBASE_AUTH_URL } from "src/utils/consts";

export async function processGetResult({
  rid,
  privateKey,
  providerOrigin = REVIBASE_AUTH_URL,
  signal,
}: {
  rid: string;
  privateKey: string;
  providerOrigin?: string;
  signal: AbortSignal;
}): Promise<CompleteMessageRequest | CompleteSendTransactionRequest> {
  const pKey = convertBase64StringToJWK(privateKey);
  if (!pKey.alg) throw new Error("Property alg in JWK is missing.");

  const signature = await new CompactSign(
    getBase64Encoder().encode(rid) as Uint8Array,
  )
    .setProtectedHeader({ alg: pKey.alg })
    .sign(pKey);

  const res = await fetch(`${providerOrigin}/api/getResult`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ rid, signature }),
    signal,
  });

  if (!res.ok) {
    let message = "Failed to get result";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore malformed/non-json body
    }
    throw new Error(message);
  }

  return (await res.json()) as
    | CompleteMessageRequest
    | CompleteSendTransactionRequest;
}

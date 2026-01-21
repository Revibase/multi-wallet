import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
} from "@revibase/core";
import { getBase58Decoder, getUtf8Encoder } from "gill";
import { REVIBASE_AUTH_URL } from "src/utils/consts";

export async function processGetResult({
  rid,
  privateKey,
  providerOrigin = REVIBASE_AUTH_URL,
}: {
  rid: string;
  privateKey: CryptoKey;
  providerOrigin?: string;
}): Promise<CompleteMessageRequest | CompleteTransactionRequest> {
  const signature = getBase58Decoder().decode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        new Uint8Array(getUtf8Encoder().encode(rid)),
      ),
    ),
  );
  const res = await fetch(`${providerOrigin}/getResult`, {
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

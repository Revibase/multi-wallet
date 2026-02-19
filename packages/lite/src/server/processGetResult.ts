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
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ rid, signature }),
    signal,
  });

  if (!res.ok) {
    throw new Error(((await res.json()) as { error: string }).error);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not a stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  return new Promise((resolve, reject) => {
    const read = async (): Promise<void> => {
      try {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: !done });

        const blocks = buffer.split("\n\n");
        buffer = done ? "" : (blocks.pop() ?? "");

        for (const block of blocks) {
          let eventType = "message";
          let dataLine = "";

          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }

          if (!dataLine) continue;

          try {
            const data = JSON.parse(dataLine);

            if (eventType === "result") {
              resolve(
                data as CompleteMessageRequest | CompleteSendTransactionRequest,
              );
              return;
            }

            if (eventType === "error") {
              reject(new Error(data?.error ?? "Unknown error"));
              return;
            }
          } catch {}
        }

        if (done) {
          reject(new Error("Stream ended without complete result"));
          return;
        }

        read();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    read();
  });
}

import { DEFAULT_JITO_BLOCK_ENGINE_SEND_BUNDLE_URL } from "src/utils/consts";

export async function processSendJitoBundleCallback(
  serializedTransactions: string[],
  jitoUUID?: string,
  url = DEFAULT_JITO_BLOCK_ENGINE_SEND_BUNDLE_URL,
): Promise<string> {
  const maxRetries = 5;
  const baseBackoffMs = 250;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [
      serializedTransactions,
      {
        encoding: "base64",
      },
    ],
  });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const parseRetryAfterMs = (res: Response): number | null => {
    const value = res.headers.get("retry-after");
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.round(seconds * 1000);
    const dateMs = Date.parse(value);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
    return null;
  };

  let response: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jitoUUID ? { "x-jito-auth": jitoUUID } : {}),
      },
      body,
    });

    if (response.status !== 429) break;
    if (attempt === maxRetries) break;

    const retryAfterMs = parseRetryAfterMs(response);
    const backoffMs = Math.min(10_000, baseBackoffMs * 2 ** attempt);
    await sleep(retryAfterMs ?? backoffMs);
  }

  if (!response) {
    throw new Error("Failed to send bundles: no response");
  }

  const data = (await response.json()) as { result?: string; error?: unknown };

  if (data.error) {
    throw new Error(
      `Error sending bundles: ${JSON.stringify(data.error, null, 2)}`,
    );
  }

  if (!data.result) {
    throw new Error("No bundle ID returned from Jito");
  }

  return data.result;
}

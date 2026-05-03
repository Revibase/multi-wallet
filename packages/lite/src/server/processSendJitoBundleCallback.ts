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

    const backoffMs = Math.min(10_000, baseBackoffMs * 2 ** attempt);
    await sleep(backoffMs);
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

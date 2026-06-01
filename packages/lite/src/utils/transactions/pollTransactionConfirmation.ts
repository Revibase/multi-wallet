import { getSolanaRpc } from "@revibase/core";
import type { Signature } from "@solana/kit";
import { withRetry } from "../retry";

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export async function pollTransactionConfirmation(
  txSig: string,
  options?: {
    maxRetries?: number;
    delayMs?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const maxRetries = options?.maxRetries ?? 30;
  const delayMs = options?.delayMs ?? 2000;
  const { signal } = options ?? {};

  for (let i = 0; i < maxRetries; i++) {
    throwIfAborted(signal);

    const status = await withRetry(() =>
      getSolanaRpc()
        .getSignatureStatuses([txSig as Signature])
        .send(),
    );

    const confirmation = status.value[0];

    if (
      confirmation?.confirmationStatus === "confirmed" ||
      confirmation?.confirmationStatus === "finalized"
    ) {
      return txSig;
    }

    await sleep(delayMs, signal);
  }

  throw new Error("Transaction confirmation timeout");
}

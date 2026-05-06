import type { CompleteMessageRequest } from "@revibase/core";
import type { SignInAuthorizationFlowOptions } from "../types";

export async function fetchSignatureFromTransactionManager({
  data,
  url,
  options,
}: {
  data: {
    publicKey: string;
    payload: CompleteMessageRequest;
  };
  url: string;
  options?: SignInAuthorizationFlowOptions;
}) {
  const maxAttempts = 10;
  const retryDelayMs = 400;
  const wsUrl = toWebSocketUrl(url);
  const { pendingApprovalsCallback, signal } = options ?? {};

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw Error("Aborted");
    let signatures: string[] | undefined;
    let ws: WebSocket | undefined;
    try {
      ws = await openWebSocket(wsUrl, signal);
      ws.send(JSON.stringify({ type: "message", data }));
      await readWebSocketJsonEvents(
        ws,
        (event, data) => {
          if (event === "error") {
            const err =
              data &&
              typeof data === "object" &&
              typeof (data as { error?: string }).error === "string"
                ? (data as { error: string }).error
                : "Unknown error";
            const e = new Error(err) as Error & { noRetry: true };
            e.noRetry = true;
            throw e;
          }
          if (event === "signatures") {
            signatures = (data as { signatures?: string[] }).signatures;
            return true;
          }
          if (event === "pending_transaction_approval") {
            pendingApprovalsCallback?.onPendingApprovalsCallback?.(
              (data as { validTill: number }).validTill,
            );
          } else if (event === "transaction_approved") {
            pendingApprovalsCallback?.onPendingApprovalsSuccess?.();
          }
          return false;
        },
        signal,
      );
    } catch (e: unknown) {
      if (e && typeof e === "object" && (e as { noRetry?: true }).noRetry) {
        throw new Error(`${(e as Error).message}`);
      }
      if (
        e &&
        typeof e === "object" &&
        (e as { name?: string }).name === "AbortError"
      )
        throw e;
    } finally {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    }
    if (signatures?.length) {
      return signatures[0];
    }
    if (i < maxAttempts - 1)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error("Transaction manager: missing signatures");
}

function toWebSocketUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol === "http:") u.protocol = "ws:";
  return u.toString();
}

function openWebSocket(url: string, signal?: AbortSignal): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const onAbort = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    ws.onopen = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(ws);
    };
    ws.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

async function readWebSocketJsonEvents(
  ws: WebSocket,
  onEvent: (event: string, data: any) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener("abort", onAbort);

    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      let parsed: { event?: string; data?: unknown };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      const event = typeof parsed.event === "string" ? parsed.event : "message";
      const data = parsed.data;
      try {
        if (onEvent(event, data)) {
          finish(() => resolve());
        }
      } catch (e) {
        finish(() => reject(e));
      }
    };

    const onError = () => {
      finish(() => reject(new Error("Transaction manager request failed")));
    };

    const onClose = () => {
      finish(() => resolve());
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

import type {
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import { bufferToBase64URLString } from "@revibase/core";
import { WalletProviderError } from "src/utils/errors";
import type { ClientAuthorizationCallback } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import {
  CLOSE_POLL_GRACE_MS,
  CONNECT_GRACE_MS,
  createPopUp,
  DEFAULT_TIMEOUT,
  HEARTBEAT_INTERVAL,
  type Options,
  type Pending,
  POLL_BACKOFF,
  POLL_INITIAL_DELAY_MS,
  POLL_MAX_DELAY_MS,
  type PollResponse,
  type PopupConnectMessage,
  type PopupPortMessage,
} from "./utils";

/**
 * RevibaseProvider handles the communication between the client application
 * and the Revibase authentication provider using popup windows and MessageChannel.
 *
 * The provider manages authentication flows, popup windows, and fallback polling
 * mechanisms to ensure reliable communication with the authentication service.
 *
 * @example
 * ```ts
 * const provider = new RevibaseProvider({
 *   onClientAuthorizationCallback: async (request) => {
 *     // Handle authorization
 *   }
 * });
 * ```
 */
export class RevibaseProvider {
  private readonly pending = new Map<string, Pending>();
  public readonly onClientAuthorizationCallback: ClientAuthorizationCallback;
  private readonly providerOrigin: string;
  private readonly providerFetchResultUrl: string;
  private popUp: Window | null = null;

  constructor(opts: Options) {
    this.onClientAuthorizationCallback = opts.onClientAuthorizationCallback;
    this.providerOrigin = opts.providerOrigin ?? REVIBASE_AUTH_URL;
    this.providerFetchResultUrl =
      opts.providerFetchResultUrl ?? `${this.providerOrigin}/api/getResult`;
  }

  /**
   * Opens a blank popup window for authentication.
   * The popup will be reused for subsequent navigation.
   *
   * @throws {WalletProviderError} If popup is blocked by the browser
   */
  openBlankPopUp(): void {
    this.popUp = createPopUp();
    if (!this.popUp) {
      throw new WalletProviderError(
        "Popup blocked. Please enable popups in your browser settings."
      );
    }
  }

  /**
   * Sends a payload to the provider and waits for the response.
   * Opens a popup window and handles communication via MessageChannel with polling fallback.
   *
   * @param payload - Start message or transaction request
   * @param signature - Client signature for the payload
   * @param timeoutMs - Timeout in milliseconds (defaults to DEFAULT_TIMEOUT)
   * @returns The response from the provider
   * @throws {Error} If called outside browser, if another flow is in progress, or if timeout occurs
   */
  /**
   * Sends a payload to the provider and waits for the response.
   * Opens a popup window and handles communication via MessageChannel with polling fallback.
   *
   * @param payload - Start message or transaction request
   * @param signature - Client signature for the payload
   * @param timeoutMs - Timeout in milliseconds (defaults to DEFAULT_TIMEOUT)
   * @returns The response from the provider
   * @throws {WalletProviderError} If called outside browser, if another flow is in progress, or if timeout occurs
   */
  async sendPayloadToProvider({
    payload,
    signature,
    timeoutMs = DEFAULT_TIMEOUT,
  }: {
    payload: StartMessageRequest | StartTransactionRequest;
    signature: string;
    timeoutMs?: number;
  }): Promise<unknown> {
    if (typeof window === "undefined") {
      throw new WalletProviderError(
        "Provider can only be used in a browser environment"
      );
    }

    if (this.pending.size > 0) {
      throw new WalletProviderError(
        "An authorization flow is already in progress"
      );
    }

    if (timeoutMs <= 0) {
      throw new WalletProviderError("Timeout must be greater than 0");
    }

    const rid = bufferToBase64URLString(
      crypto.getRandomValues(new Uint8Array(16))
    );

    const url = new URL(this.providerOrigin);
    url.searchParams.set("rid", rid);
    url.searchParams.set(
      "payload",
      bufferToBase64URLString(new TextEncoder().encode(JSON.stringify(payload)))
    );
    url.searchParams.set("sig", signature);

    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const entry = this.pending.get(rid);
        if (!entry) return;

        // Route through unified cleanup path if available
        if (entry.cancel) {
          entry.cancel(
            new WalletProviderError("Authentication timed out")
          );
        } else {
          this.pending.delete(rid);
          reject(new WalletProviderError("Authentication timed out"));
        }
      }, timeoutMs);

      this.pending.set(rid, { rid, resolve, reject, timeoutId });

      this.openWebPopup({
        startUrl: url.toString(),
        origin: url.origin,
        rid,
        timeoutMs,
      });
    });
  }

  /**
   * Communicates with the popup using MessageChannel.
   * Falls back to polling if connection fails or popup closes.
   *
   * @private
   */
  private openWebPopup(params: {
    startUrl: string;
    origin: string;
    rid: string;
    timeoutMs: number;
  }) {
    const { startUrl, origin, rid, timeoutMs } = params;

    const entry = this.pending.get(rid);
    if (!entry) return;

    let popup: Window | null = this.popUp ?? null;
    let port: MessagePort | null = null;

    let finished = false;
    let connected = false;
    let closeHandled = false;

    let pollKickoff: ReturnType<typeof setTimeout> | null = null;
    let pollInFlight: Promise<void> | null = null;
    let activePollAbort: AbortController | null = null;

    let popupReady = false;

    const deadlineMs = Date.now() + timeoutMs;

    const abortActivePoll = (): void => {
      try {
        activePollAbort?.abort();
      } catch {
        // Ignore abort errors
      }
      activePollAbort = null;
    };

    const clearKickoff = (): void => {
      if (pollKickoff) {
        clearTimeout(pollKickoff);
        pollKickoff = null;
      }
    };

    const cleanup = (): void => {
      window.removeEventListener("message", onConnect);

      clearKickoff();
      abortActivePoll();

      try {
        port?.close();
      } catch {
        // Ignore close errors
      }
      port = null;

      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch {
        // Ignore close errors
      }
      this.popUp = null;

      clearInterval(heartbeatId);
    };

    const fail = (err: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timeoutId);
      this.pending.delete(rid);
      cleanup();
      entry.reject(err);
    };

    const succeed = (payload: unknown): void => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timeoutId);
      this.pending.delete(rid);
      cleanup();
      entry.resolve(payload);
    };

    entry.cancel = fail;

    const ensurePopupOpenedAndNavigated = (): Window => {
      // Open or reuse popup
      if (!popup) {
        popup = createPopUp(startUrl);
      } else {
        // MUST navigate (no silent fallback)
        try {
          // Location access can throw; if it does, we still try replace
          if (popup.location.href !== startUrl) {
            popup.location.replace(startUrl);
          }
        } catch {
          // If replace throws too, we consider navigation failed
          try {
            popup.location.replace(startUrl);
          } catch {
            throw new WalletProviderError(
              "Unable to navigate popup to provider URL"
            );
          }
        }
      }

      if (!popup) {
        throw new WalletProviderError(
          "Popup blocked. Please enable popups in your browser settings."
        );
      }
      popupReady = true;
      return popup;
    };

    /**
     * Polling gate: idempotent + never concurrent.
     * Only polls if popupReady is true (i.e., popup is open + navigation attempted).
     * Never polls while connected (we prefer MessageChannel).
     */
    const ensurePolling = (untilMs: number = deadlineMs): Promise<void> => {
      if (finished || !popupReady || connected) {
        return Promise.resolve();
      }
      if (pollInFlight) {
        return pollInFlight;
      }

      pollInFlight = (async () => {
        try {
          abortActivePoll();
          activePollAbort = new AbortController();

          const result = await this.pollForResult({
            rid,
            deadlineMs: untilMs,
            signal: activePollAbort.signal,
          });

          if (finished) return;

          if (result.status === "complete") {
            succeed(result.payload);
          } else if (result.status === "error") {
            fail(new WalletProviderError(result.error));
          }
          // pending/timeout => do nothing; caller decides next step
        } finally {
          pollInFlight = null;
        }
      })();

      return pollInFlight;
    };

    // --- Start: open popup + require navigation
    try {
      popup = ensurePopupOpenedAndNavigated();
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    // If MessageChannel doesn't connect in time, start fallback polling
    pollKickoff = setTimeout(() => {
      if (finished || connected) return;
      ensurePolling().catch(() => {});
    }, CONNECT_GRACE_MS);

    // Detect user closing popup
    const heartbeatId = setInterval(() => {
      if (!popup?.closed) return;
      if (closeHandled) return;
      closeHandled = true;

      // Poll until deadline; if still nothing, report closed
      const briefUntil = Math.min(deadlineMs, Date.now() + CLOSE_POLL_GRACE_MS);

      ensurePolling(briefUntil)
        .then(() => {
          if (!finished)
            fail(
              new WalletProviderError(
                "User closed the authentication window"
              )
            );
        })
        .catch(() =>
          fail(
            new WalletProviderError("User closed the authentication window")
          )
        );
    }, HEARTBEAT_INTERVAL);

    const onConnect = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== popup) return;

      const data = event.data as PopupConnectMessage;
      if (data?.type !== "popup-connect") return;
      if (data.rid !== rid) return;
      if (!event.ports?.[0]) return;

      connected = true;

      // Once connected: stop kickoff + stop any in-flight poll
      clearKickoff();
      abortActivePoll();

      port = event.ports[0];
      port.start();

      port.postMessage({ type: "popup-init" });

      port.onmessage = (ev: MessageEvent<PopupPortMessage>): void => {
        switch (ev.data.type) {
          case "popup-complete":
            succeed(ev.data.payload);
            break;

          case "popup-error":
            fail(new WalletProviderError(ev.data.error));
            break;

          case "popup-closed": {
            // Provider says closed; channel may be dead soon.
            // Allow fallback polling from now on.
            connected = false;
            abortActivePoll();

            const briefUntil = Math.min(
              deadlineMs,
              Date.now() + CLOSE_POLL_GRACE_MS
            );

            ensurePolling(briefUntil)
              .then(() => {
                if (!finished) {
                  fail(
                    new WalletProviderError(
                      "User closed the authentication window"
                    )
                  );
                }
              })
              .catch(() => {
                fail(
                  new WalletProviderError(
                    "User closed the authentication window"
                  )
                );
              });
            break;
          }
        }
      };

      window.removeEventListener("message", onConnect);
    };

    window.addEventListener("message", onConnect);
  }

  private async pollForResult({
    rid,
    deadlineMs,
    signal,
  }: {
    rid: string;
    deadlineMs: number; // epoch ms
    signal?: AbortSignal;
  }): Promise<PollResponse> {
    let delay = POLL_INITIAL_DELAY_MS;

    const pollOnce = async (): Promise<PollResponse> => {
      const endpoint = new URL(this.providerFetchResultUrl);
      endpoint.searchParams.set("rid", rid);

      const res = await fetch(endpoint.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal,
        cache: "no-store",
        credentials: "omit",
      });

      if (!res.ok) {
        // treat transient non-200 as pending
        return { status: "pending" };
      }

      let json: unknown = null;
      try {
        json = (await res.json()) as PollResponse;
      } catch {
        return { status: "pending" };
      }

      // Validate response structure
      if (!json || typeof json !== "object") {
        return { status: "pending" };
      }

      const response = json as Record<string, unknown>;
      if (response.status === "complete") {
        return { status: "complete", payload: response.payload };
      }
      if (response.status === "error") {
        return {
          status: "error",
          error: String(response.error ?? "Unknown error"),
        };
      }

      return { status: "pending" };
    };

    while (Date.now() < deadlineMs) {
      if (signal?.aborted) return { status: "pending" };

      try {
        const r = await pollOnce();
        if (r.status === "complete") return r;
        if (r.status === "error") return r;
      } catch {
        // network errors -> keep trying until deadline
      }

      const remaining = deadlineMs - Date.now();
      const sleepMs = Math.min(delay, Math.max(0, remaining));
      await new Promise((r) => setTimeout(r, jitter(sleepMs)));

      delay = Math.min(POLL_MAX_DELAY_MS, Math.round(delay * POLL_BACKOFF));
    }

    return { status: "timeout" };
  }
}

/**
 * Adds jitter to a delay value to prevent thundering herd problems.
 *
 * @param ms - Base delay in milliseconds
 * @param pct - Percentage of jitter (default 0.3 = 30%)
 * @returns Jittered delay value
 */
function jitter(ms: number, pct = 0.3): number {
  const delta = ms * pct;
  const v = ms + (Math.random() * 2 - 1) * delta;
  return Math.max(0, Math.round(v));
}

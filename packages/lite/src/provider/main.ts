import type { UserInfo } from "@revibase/core";
import { initialize } from "@revibase/core";
import { getBase64Decoder } from "@solana/kit";
import { linkAbortSignal, type AbortScope } from "../utils/abort";
import type {
  ClientAuthorizationCallback,
  OnConnectedCallback,
  OnSuccessCallback,
} from "../utils";
import { REVIBASE_AUTH_URL, REVIBASE_RP_ID } from "../utils/consts";
import {
  RevibaseAbortedError,
  RevibaseAuthError,
  RevibaseEnvironmentError,
  RevibaseFlowInProgressError,
  RevibasePopupBlockedError,
  RevibasePopupClosedError,
  RevibaseTimeoutError,
} from "../utils/errors";
import {
  CONNECT_TIMEOUT,
  createPopUp,
  defaultClientAuthorizationCallback,
  defaultEstimateJitoTipsCallback,
  defaultSendJitoBundleCallback,
  HEARTBEAT_INTERVAL,
  RESULT_SAFETY_TIMEOUT,
  SUCCESS_DISPLAY_TIMEOUT,
  type Pending,
  type PopupConnectMessage,
  type PopupPortMessage,
  type ProviderPortMessage,
  type RevibaseProviderOptions,
} from "./utils";

/** Provider: popup or channel auth. Default callback: POST /api/clientAuthorization. */
export class RevibaseProvider {
  public onClientAuthorizationCallback: ClientAuthorizationCallback;
  public onSendJitoBundleCallback: (request: string[]) => Promise<string>;
  public onEstimateJitoTipsCallback: () => Promise<number>;
  public providerOrigin: string;
  public rpId: string;
  private popUp: Window | null = null;

  constructor(options: RevibaseProviderOptions) {
    const {
      rpId,
      rpcEndpoint,
      providerOrigin,
      onClientAuthorizationCallback,
      onSendJitoBundleCallback,
      onEstimateJitoTipsCallback,
    } = options;

    initialize({ rpcEndpoint });
    this.onClientAuthorizationCallback =
      onClientAuthorizationCallback ?? defaultClientAuthorizationCallback;
    this.onSendJitoBundleCallback =
      onSendJitoBundleCallback ?? defaultSendJitoBundleCallback;
    this.onEstimateJitoTipsCallback =
      onEstimateJitoTipsCallback ?? defaultEstimateJitoTipsCallback;
    this.providerOrigin = providerOrigin ?? REVIBASE_AUTH_URL;
    this.rpId = rpId ?? REVIBASE_RP_ID;
  }

  async sendRequestToPopupProvider({
    onConnectedCallback,
    onSuccessCallback,
    signal,
  }: {
    onConnectedCallback: OnConnectedCallback;
    onSuccessCallback: OnSuccessCallback;
    signal?: AbortSignal;
  }) {
    if (typeof window === "undefined") {
      throw new RevibaseEnvironmentError();
    }

    if (this.popUp) {
      throw new RevibaseFlowInProgressError();
    }

    const rid = getBase64Decoder().decode(
      crypto.getRandomValues(new Uint8Array(16)),
    );
    const clientOrigin = window.location.origin;
    const popupUrl = `${this.providerOrigin}?clientOrigin=${encodeURIComponent(clientOrigin)}&rid=${encodeURIComponent(rid)}`;

    this.popUp = createPopUp(popupUrl);
    if (!this.popUp) {
      throw new RevibasePopupBlockedError();
    }

    return new Promise<{ user: UserInfo } | { txSig: string; user: UserInfo }>(
      (resolve, reject) => {
        setTimeout(() => {
          this.attachTransport({
            rid,
            clientOrigin,
            onConnectedCallback,
            onSuccessCallback,
            signal,
            resolve,
            reject,
          });
        }, 0);
      },
    );
  }

  private attachTransport(params: Pending) {
    const {
      rid,
      clientOrigin,
      onConnectedCallback,
      onSuccessCallback,
      signal,
      reject,
      resolve,
    } = params;

    // Flow lifecycle. The key change vs. the old design: passkey approval
    // ("popup-complete") no longer ends the flow — it begins the PROCESSING
    // phase, during which the popup stays open and the provider streams status
    // and the final result over the port. Promise settlement (resolve/reject)
    // is decoupled from UI teardown (closing the popup).
    type Phase = "connecting" | "awaiting" | "processing" | "result";
    let phase: Phase = "connecting";
    let settled = false; // resolve/reject fired
    let toreDown = false; // UI/listeners closed

    let port: MessagePort | null = null;
    let processingAbort: AbortScope | null = null;
    let lastPong = Date.now();

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let requestTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let resultTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const post = (msg: ProviderPortMessage): void => {
      try {
        port?.postMessage(msg);
      } catch {
        // Ignore post errors; heartbeat will detect a dead channel.
      }
    };

    const clearTimers = (): void => {
      for (const id of [
        heartbeatInterval,
        connectTimeoutId,
        requestTimeoutId,
        resultTimeoutId,
      ]) {
        if (id) clearTimeout(id as ReturnType<typeof setTimeout>);
      }
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      connectTimeoutId = null;
      requestTimeoutId = null;
      resultTimeoutId = null;
    };

    const teardown = (): void => {
      if (toreDown) return;
      toreDown = true;

      window.removeEventListener("message", onConnect);
      signal?.removeEventListener("abort", abortHandler);
      clearTimers();

      try {
        processingAbort?.dispose();
      } catch {
        // ignore
      }

      try {
        port?.close();
      } catch {
        // ignore
      }
      port = null;

      try {
        if (this.popUp && !this.popUp.closed) this.popUp.close();
      } catch {
        // ignore
      }

      this.popUp = null;
    };

    const settleResolve = (
      value: { user: UserInfo } | { user: UserInfo; txSig: string },
    ): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const settleReject = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    // Terminal failure with no further UI display (abort, rejection, setup
    // errors): reject and tear down immediately.
    const finishWithError = (err: Error): void => {
      processingAbort?.abort();
      settleReject(err);
      teardown();
    };

    // The user closed the popup. If the flow hasn't settled yet, abort any
    // in-flight work and reject; either way tear the UI down.
    const handlePopupClosed = (message: string): void => {
      if (!settled) {
        processingAbort?.abort();
        settleReject(new RevibasePopupClosedError(message));
      }
      teardown();
    };

    const abortHandler = () => {
      finishWithError(new RevibaseAbortedError());
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    const uiIsClosed = (): boolean => !!this.popUp?.closed;

    // Passkey approved — keep the popup open and run the actual completion
    // (backend complete + broadcast + optional 2FA wait + confirmation),
    // streaming progress to the popup, then send the final result.
    const runProcessing = (
      payload: Extract<PopupPortMessage, { type: "popup-complete" }>["payload"],
    ): void => {
      phase = "processing";

      // The request-expiry timeout bounded the passkey wait, not the network
      // work that follows (which has its own internal timeouts).
      if (requestTimeoutId) {
        clearTimeout(requestTimeoutId);
        requestTimeoutId = null;
      }

      processingAbort = linkAbortSignal(signal);
      post({ type: "status", phase: "submitting" });

      Promise.resolve(
        onSuccessCallback(payload as any, {
          reportStatus: (status) => post({ type: "status", ...status }),
          signal: processingAbort.signal,
        }),
      )
        .then((result) => {
          if (settled) return;
          phase = "result";
          post({ type: "result", ok: true });
          settleResolve(result);
          // Brief grace so the popup can paint success, then close it.
          resultTimeoutId = setTimeout(teardown, SUCCESS_DISPLAY_TIMEOUT);
        })
        .catch((err: unknown) => {
          if (settled) return;
          phase = "result";
          const error = err instanceof Error ? err : new Error(String(err));
          post({ type: "result", ok: false, error: error.message });
          settleReject(error);
          // Keep the popup open so it can display the error; the popup sends
          // popup-closed when the user dismisses. Safety net if it never does.
          resultTimeoutId = setTimeout(teardown, RESULT_SAFETY_TIMEOUT);
        });
    };

    // Connection timeout - handles popup closed before connection
    connectTimeoutId = setTimeout(() => {
      finishWithError(
        new RevibaseTimeoutError("Popup connection timed out after 20s"),
      );
    }, CONNECT_TIMEOUT);

    const onConnect = (event: MessageEvent) => {
      // Prevent race condition - only process once
      if (toreDown || port) return;

      // Validate message origin
      if (event.origin !== this.providerOrigin) return;

      const data = event.data as PopupConnectMessage;

      // Validate message structure
      if (!data || data.type !== "popup-connect") return;
      if (data.rid !== rid) return;

      // Clear connection timeout
      if (connectTimeoutId) {
        clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }

      // Create MessageChannel for bidirectional communication
      const channel = new MessageChannel();
      port = channel.port1;
      port.start();

      lastPong = Date.now();

      // Heartbeat: detect popup dismissal in every phase until teardown. A
      // close during connecting/awaiting/processing aborts the flow; after the
      // result is shown it just tears the UI down.
      heartbeatInterval = setInterval(() => {
        if (toreDown) {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = null;
          return;
        }

        if (uiIsClosed()) {
          handlePopupClosed("Provider UI was closed");
          return;
        }

        if (!port) {
          handlePopupClosed("Message channel lost");
          return;
        }

        if (Date.now() - lastPong > HEARTBEAT_INTERVAL * 2) {
          handlePopupClosed("Lost connection to popup (heartbeat timeout)");
          return;
        }

        post({ type: "ping" });
      }, HEARTBEAT_INTERVAL);

      // Handle messages from popup
      port.onmessage = (ev: MessageEvent<PopupPortMessage>): void => {
        const msg = ev.data;

        switch (msg.type) {
          case "pong":
            lastPong = Date.now();
            break;

          case "popup-complete":
            if (phase !== "awaiting") return; // ignore stray/duplicate
            if (msg.payload) {
              runProcessing(msg.payload);
            } else {
              finishWithError(new RevibaseAuthError("Invalid completion payload"));
            }
            break;

          case "popup-rejected":
            finishWithError(new RevibaseAuthError("User rejected the operation"));
            break;

          case "popup-error":
            finishWithError(
              new RevibaseAuthError(msg.error || "Unknown popup error"),
            );
            break;

          case "popup-closed":
            handlePopupClosed("User closed popup");
            break;

          default:
            console.warn("Unknown message type from popup:", msg);
        }
      };

      // Handle port errors
      port.onmessageerror = () => {
        finishWithError(new RevibaseAuthError("Message deserialization error"));
      };

      // Send init message to popup with port2
      try {
        const initMessage: ProviderPortMessage = { type: "popup-init", rid };
        this.popUp?.postMessage(initMessage, this.providerOrigin, [
          channel.port2,
        ]);
      } catch (err) {
        finishWithError(
          new RevibaseAuthError(`Failed to initialize popup: ${err}`),
        );
        return;
      }

      // Call the callback to get the request
      onConnectedCallback(rid, clientOrigin)
        .then((result) => {
          // Verify we're still active
          if (toreDown || settled || !port || uiIsClosed()) return;

          // Send the request to popup
          try {
            post({ type: "popup-start", payload: result });
          } catch (err) {
            finishWithError(
              new RevibaseAuthError(`Failed to send request to popup: ${err}`),
            );
            return;
          }

          phase = "awaiting";

          // Bound the time we wait for the user to approve with their passkey.
          if (requestTimeoutId) {
            clearTimeout(requestTimeoutId);
            requestTimeoutId = null;
          }
          const timeoutDuration = Math.max(
            0,
            result.request.validTill - Date.now(),
          );
          requestTimeoutId = setTimeout(() => {
            // Only meaningful while still waiting for approval.
            if (phase === "awaiting") {
              finishWithError(new RevibaseTimeoutError("Request expired"));
            }
          }, timeoutDuration);
        })
        .catch((err: unknown) => {
          finishWithError(
            err instanceof Error ? err : new Error(String(err)),
          );
        });
    };

    // Attach connect listener
    window.addEventListener("message", onConnect);
  }
}

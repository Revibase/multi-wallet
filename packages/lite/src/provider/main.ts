import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import { initialize } from "@revibase/core";
import { getBase64Decoder } from "gill";
import type { ClientAuthorizationCallback } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import {
  RevibaseAbortedError,
  RevibaseAuthError,
  RevibaseEnvironmentError,
  RevibaseFlowInProgressError,
  RevibasePopupClosedError,
  RevibaseTimeoutError,
} from "src/utils/errors";
import {
  CONNECT_TIMEOUT,
  createPopUp,
  defaultClientAuthorizationCallback,
  defaultEstimateJitoTipsCallback,
  defaultSendJitoBundleCallback,
  HEARTBEAT_INTERVAL,
  type Pending,
  type PopupConnectMessage,
  type PopupPortMessage,
  type RevibaseProviderOptions,
} from "./utils";

/** Provider: popup or channel auth. Default callback: POST /api/clientAuthorization. */
export class RevibaseProvider {
  private readonly pending = new Map<string, Pending>();
  public onClientAuthorizationCallback: ClientAuthorizationCallback;
  public onSendJitoBundleCallback: (request: string[]) => Promise<string>;
  public onEstimateJitoTipsCallback: () => Promise<number>;
  private providerOrigin: string;
  private popUpConfig: {
    popUp: Window;
    rid: string;
    clientOrigin: string;
  } | null = null;

  constructor(options: RevibaseProviderOptions) {
    const {
      rpcEndpoint,
      providerOrigin,
      onClientAuthorizationCallback,
      onSendJitoBundleCallback,
      onEstimateJitoTipsCallback,
    } = options;
    this.onClientAuthorizationCallback =
      onClientAuthorizationCallback ?? defaultClientAuthorizationCallback;
    this.onSendJitoBundleCallback =
      onSendJitoBundleCallback ?? defaultSendJitoBundleCallback;
    this.onEstimateJitoTipsCallback =
      onEstimateJitoTipsCallback ?? defaultEstimateJitoTipsCallback;
    this.providerOrigin = providerOrigin ?? REVIBASE_AUTH_URL;
    initialize({ rpcEndpoint });
  }

  public async startRequest() {
    const rid = getBase64Decoder().decode(
      crypto.getRandomValues(new Uint8Array(16)),
    );
    const clientOrigin = window.location.origin;

    const popupUrl = `${new URL(this.providerOrigin).origin}?clientOrigin=${encodeURIComponent(clientOrigin)}&rid=${encodeURIComponent(rid)}`;
    const popUp = createPopUp(popupUrl);

    if (!popUp) {
      throw new Error("Popup blocked. Please allow popups for this site.");
    }

    await new Promise((r) => setTimeout(r, 100));

    this.popUpConfig = {
      popUp,
      rid,
      clientOrigin,
    };
  }

  sendRequestToPopupProvidr({
    onConnectedCallback,
    signal,
  }: {
    onConnectedCallback: (
      rid: string,
      clientOrigin: string,
    ) => Promise<{
      request: StartMessageRequest | StartTransactionRequest;
      signature: string;
    }>;
    signal?: AbortSignal;
  }) {
    if (typeof window === "undefined") {
      throw new RevibaseEnvironmentError();
    }

    if (this.pending.size > 0) {
      throw new RevibaseFlowInProgressError();
    }

    // Check if already aborted
    if (signal?.aborted) {
      throw new RevibaseAbortedError();
    }

    return new Promise<CompleteMessageRequest | CompleteTransactionRequest>(
      (resolve, reject) => {
        if (!this.popUpConfig) {
          reject(new Error("Start request must be called first."));
          return;
        }
        const { popUp, rid, clientOrigin } = this.popUpConfig;

        const entry = {
          rid,
          clientOrigin,
          resolve,
          reject,
          cancel: (error: Error) => {
            reject(error);
          },
        };

        this.pending.set(rid, entry);

        // Setup abort handler immediately
        const abortHandler = () => {
          const entry = this.pending.get(rid);
          if (entry) {
            entry.cancel?.(new RevibaseAbortedError());
            this.pending.delete(rid);
          }
        };
        signal?.addEventListener("abort", abortHandler, { once: true });

        // Attach transport with all handlers
        this.attachTransport({
          popup: popUp,
          origin: new URL(this.providerOrigin).origin,
          rid,
          clientOrigin,
          onConnectedCallback,
          signal,
          abortHandler,
        });
      },
    );
  }

  private attachTransport(params: {
    popup: Window;
    origin: string;
    rid: string;
    clientOrigin: string;
    onConnectedCallback: (
      rid: string,
      clientOrigin: string,
    ) => Promise<{
      request: StartMessageRequest | StartTransactionRequest;
      signature: string;
    }>;
    signal?: AbortSignal;
    abortHandler: () => void;
  }) {
    const {
      popup,
      origin,
      rid,
      clientOrigin,
      onConnectedCallback,
      signal,
      abortHandler,
    } = params;

    const entry = this.pending.get(rid);
    if (!entry) return;

    let port: MessagePort | null = null;
    let finished = false;

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let requestTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let popupCheckInterval: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
      // Remove all event listeners
      window.removeEventListener("message", onConnect);
      signal?.removeEventListener("abort", abortHandler);

      // Clear all timers
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (connectTimeoutId) {
        clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }
      if (requestTimeoutId) {
        clearTimeout(requestTimeoutId);
        requestTimeoutId = null;
      }
      if (popupCheckInterval) {
        clearInterval(popupCheckInterval);
        popupCheckInterval = null;
      }

      // Close message port
      try {
        port?.close();
      } catch (err) {
        // Ignore close errors
      }
      port = null;

      // Close popup
      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch (err) {
        // Ignore close errors
      }

      this.popUpConfig = null;
    };

    const fail = (err: Error): void => {
      if (finished) return;
      finished = true;

      this.pending.delete(rid);
      cleanup();

      entry.reject(err);
    };

    const succeed = (
      value: CompleteMessageRequest | CompleteTransactionRequest,
    ): void => {
      if (finished) return;
      finished = true;

      this.pending.delete(rid);
      cleanup();

      entry.resolve(value);
    };

    // Check if popup is closed periodically BEFORE connection established
    popupCheckInterval = setInterval(() => {
      if (finished || port) {
        // Connection established, heartbeat will handle this
        if (popupCheckInterval) {
          clearInterval(popupCheckInterval);
          popupCheckInterval = null;
        }
        return;
      }

      if (popup.closed) {
        fail(
          new RevibasePopupClosedError("Popup was closed before connection"),
        );
      }
    }, 500);

    // Connection timeout
    connectTimeoutId = setTimeout(() => {
      fail(new RevibaseTimeoutError("Popup connection timed out after 20s"));
    }, CONNECT_TIMEOUT);

    const onConnect = (event: MessageEvent) => {
      // Prevent race condition - only process once
      if (finished || port) return;

      // Validate message origin and source
      if (event.origin !== origin) return;
      if (event.source !== popup) return;

      const data = event.data as PopupConnectMessage;

      // Validate message structure
      if (!data || data.type !== "popup-connect") return;
      if (data.rid !== rid) return;

      // Double-check we still have pending entry
      if (!this.pending.has(rid)) return;

      // Clear connection timeout
      if (connectTimeoutId) {
        clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }

      // Stop popup closed checking - heartbeat will handle it now
      if (popupCheckInterval) {
        clearInterval(popupCheckInterval);
        popupCheckInterval = null;
      }

      // Create MessageChannel for bidirectional communication
      const channel = new MessageChannel();
      port = channel.port1;
      port.start();

      let lastPong = Date.now();

      // Start heartbeat to detect popup closure
      heartbeatInterval = setInterval(() => {
        if (finished) {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          return;
        }

        // Check if popup is closed
        if (popup.closed) {
          fail(new RevibasePopupClosedError("Popup was closed"));
          return;
        }

        // Check if port is still available
        if (!port) {
          fail(new RevibasePopupClosedError("Message channel lost"));
          return;
        }

        const now = Date.now();

        // Check if we've lost connection (no pong in 2x heartbeat interval)
        if (now - lastPong > HEARTBEAT_INTERVAL * 2) {
          fail(
            new RevibasePopupClosedError(
              "Lost connection to popup (heartbeat timeout)",
            ),
          );
          return;
        }

        // Send ping
        try {
          port.postMessage({ type: "ping" });
        } catch (err) {
          fail(new RevibasePopupClosedError("Failed to send heartbeat"));
        }
      }, HEARTBEAT_INTERVAL);

      // Handle messages from popup
      port.onmessage = (ev: MessageEvent<PopupPortMessage>): void => {
        if (finished) return;
        const msg = ev.data;

        switch (msg.type) {
          case "pong":
            lastPong = Date.now();
            break;

          case "popup-complete":
            if (msg.payload) {
              succeed(msg.payload);
            } else {
              fail(new RevibaseAuthError("Invalid completion payload"));
            }
            break;

          case "popup-error":
            fail(new RevibaseAuthError(msg.error || "Unknown popup error"));
            break;

          case "popup-closed":
            fail(new RevibasePopupClosedError("User closed popup"));
            break;

          default:
            console.warn("Unknown message type from popup:", msg);
        }
      };

      // Handle port errors
      port.onmessageerror = () => {
        fail(new RevibaseAuthError("Message deserialization error"));
      };

      // Send init message to popup with port2
      try {
        popup.postMessage(
          {
            type: "popup-init",
            rid,
          },
          origin,
          [channel.port2],
        );
      } catch (err) {
        fail(new RevibaseAuthError(`Failed to initialize popup: ${err}`));
        return;
      }

      // Call the callback to get the request
      onConnectedCallback(rid, clientOrigin)
        .then((result) => {
          // Verify we're still active
          if (finished || !port || !this.pending.has(rid) || popup.closed) {
            return;
          }

          // Send the request to popup
          try {
            port.postMessage({
              type: "popup-start",
              payload: result,
            });
          } catch (err) {
            fail(
              new RevibaseAuthError(`Failed to send request to popup: ${err}`),
            );
            return;
          }

          // Clear any existing request timeout
          if (requestTimeoutId) {
            clearTimeout(requestTimeoutId);
            requestTimeoutId = null;
          }

          // Calculate TTL and set new timeout
          const timeoutDuration = Math.max(
            0,
            result.request.validTill - Date.now(),
          );

          requestTimeoutId = setTimeout(() => {
            fail(new RevibaseTimeoutError("Request expired"));
          }, timeoutDuration);
        })
        .catch((err) => {
          // Preserve original error where possible
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorStack = err instanceof Error ? err.stack : undefined;

          const authError = new RevibaseAuthError(
            `Failed to prepare request: ${errorMessage}`,
          );

          // Preserve stack trace if available
          if (errorStack) {
            authError.stack = errorStack;
          }

          fail(authError);
        });
    };

    // Attach connect listener
    window.addEventListener("message", onConnect);
  }
}

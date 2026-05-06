import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  UserInfo,
} from "@revibase/core";
import { initialize } from "@revibase/core";
import { getBase64Decoder } from "gill";
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
  type Pending,
  type PopupConnectMessage,
  type PopupPortMessage,
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
      throw new Error("Popup blocked. Please allow popups for this site.");
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

    const abortHandler = () => {
      reject(new RevibaseAbortedError());
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    let port: MessagePort | null = null;
    let finished = false;

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let requestTimeoutId: ReturnType<typeof setTimeout> | null = null;

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

      // Close message port
      try {
        port?.close();
      } catch (err) {
        // Ignore close errors
      }
      port = null;

      // Close popup
      try {
        if (this.popUp && !this.popUp.closed) {
          this.popUp.close();
        }
      } catch (err) {
        // Ignore close errors
      }

      this.popUp = null;
    };

    const fail = (err: Error): void => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };

    const succeed = (
      value: CompleteMessageRequest | CompleteTransactionRequest,
    ): void => {
      if (finished) return;
      finished = true;
      cleanup();
      onSuccessCallback(value as any)
        .then((result) => {
          resolve(result);
        })
        .catch((err) => {
          reject(err);
        });
    };

    // Connection timeout - handles popup closed before connection
    connectTimeoutId = setTimeout(() => {
      fail(new RevibaseTimeoutError("Popup connection timed out after 20s"));
    }, CONNECT_TIMEOUT);

    const onConnect = (event: MessageEvent) => {
      // Prevent race condition - only process once
      if (finished || port) return;

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

      let lastPong = Date.now();

      // Start heartbeat ONLY AFTER connection established
      heartbeatInterval = setInterval(() => {
        if (finished) {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          return;
        }

        // NOW it's safe to check popup.closed
        // Connection is established, browser won't flag as orchestration
        if (this.popUp?.closed) {
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
        this.popUp?.postMessage(
          {
            type: "popup-init",
            rid,
          },
          this.providerOrigin,
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
          if (finished || !port || this.popUp?.closed) {
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
          fail(err);
        });
    };

    // Attach connect listener
    window.addEventListener("message", onConnect);
  }
}

import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import { initialize } from "@revibase/core";
import type { ClientAuthorizationCallback } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import {
  RevibaseAbortedError,
  RevibaseAuthError,
  RevibaseEnvironmentError,
  RevibaseFlowInProgressError,
  RevibasePopupClosedError,
  RevibasePopupNotOpenError,
  RevibaseTimeoutError,
} from "src/utils/errors";
import {
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
  private popUp: Window | null = null;

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

  startRequest() {
    this.popUp = createPopUp(`${new URL(this.providerOrigin).origin}/loading`);
    if (!this.popUp) {
      throw new Error("Popup blocked. Disable your popup blocker.");
    }
  }

  async sendPayloadToProviderViaPopup({
    request,
    signature,
    signal,
  }: {
    request: StartMessageRequest | StartTransactionRequest;
    signature: string;
    signal?: AbortSignal;
  }) {
    if (typeof window === "undefined") {
      throw new RevibaseEnvironmentError();
    }

    if (this.pending.size > 0) {
      throw new RevibaseFlowInProgressError();
    }

    return new Promise<CompleteMessageRequest | CompleteTransactionRequest>(
      (resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const entry = this.pending.get(request.rid);
          if (!entry) return;

          if (entry.cancel) {
            entry.cancel(new RevibaseTimeoutError());
          } else {
            this.pending.delete(request.rid);
            reject(new RevibaseTimeoutError());
          }
        }, request.validTill - Date.now());

        if (!this.popUp || this.popUp.closed) {
          throw new RevibasePopupNotOpenError();
        }
        this.pending.set(request.rid, {
          request,
          signature,
          resolve,
          reject,
          timeoutId,
        });

        this.attachTransport({
          popup: this.popUp,
          origin: new URL(this.providerOrigin).origin,
          request,
          signature,
          signal,
        });
      },
    );
  }

  private attachTransport(params: {
    popup: Window;
    origin: string;
    request: StartMessageRequest | StartTransactionRequest;
    signature: string;
    signal?: AbortSignal;
  }) {
    const { popup, origin, request, signature, signal } = params;

    const entry = this.pending.get(request.rid);
    if (!entry) return;

    let port: MessagePort | null = null;
    let finished = false;

    const onAbort = (): void => {
      fail(new RevibaseAbortedError());
    };

    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
      window.removeEventListener("message", onConnect);

      try {
        port?.close();
      } catch {}
      port = null;

      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch {}
      this.popUp = null;

      clearInterval(heartbeatId);
    };

    const fail = (err: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timeoutId);
      this.pending.delete(request.rid);
      cleanup();
      entry.reject(err);
    };

    const succeed = (
      value: CompleteMessageRequest | CompleteTransactionRequest,
    ): void => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timeoutId);
      this.pending.delete(request.rid);
      cleanup();
      entry.resolve(value);
    };

    entry.cancel = fail;

    if (signal?.aborted) {
      fail(new RevibaseAbortedError());
      return;
    }
    signal?.addEventListener("abort", onAbort);

    const heartbeatId = setInterval(() => {
      if (!popup?.closed) return;
      fail(new RevibasePopupClosedError());
    }, HEARTBEAT_INTERVAL);

    const onConnect = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== popup) return;

      const data = event.data as PopupConnectMessage;
      if (!data || data.type !== "popup-connect") return;
      if (!event.ports?.[0]) return;

      port = event.ports[0];
      port.start();

      port.postMessage({
        type: "popup-init",
        payload: {
          request,
          signature,
        },
      });

      port.onmessage = (ev: MessageEvent<PopupPortMessage>): void => {
        switch (ev.data.type) {
          case "popup-complete":
            succeed(ev.data.payload);
            break;

          case "popup-error":
            fail(new RevibaseAuthError(ev.data.error));
            break;

          case "popup-closed": {
            fail(
              new RevibasePopupClosedError("Lost connection with the popup."),
            );
            break;
          }
        }
      };

      window.removeEventListener("message", onConnect);
    };

    window.addEventListener("message", onConnect);
  }
}

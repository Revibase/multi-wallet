import { getBase64Decoder } from "gill";
import type { ClientAuthorizationCallback } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import {
  createPopUp,
  DEFAULT_TIMEOUT,
  HEARTBEAT_INTERVAL,
  type Options,
  type Pending,
  type PopupConnectMessage,
  type PopupPortMessage,
} from "./utils";

export class RevibaseProvider {
  private readonly pending = new Map<string, Pending>();
  public readonly onClientAuthorizationCallback: ClientAuthorizationCallback;
  private readonly providerOrigin: string;
  private popUp: Window | null = null;

  constructor(opts: Options) {
    this.onClientAuthorizationCallback = opts.onClientAuthorizationCallback;
    this.providerOrigin = opts.providerOrigin ?? REVIBASE_AUTH_URL;
  }

  createNewPopup() {
    const redirectOrigin = window.origin;
    const rid = getBase64Decoder().decode(
      crypto.getRandomValues(new Uint8Array(16)),
    );
    const url = new URL(this.providerOrigin);
    url.searchParams.set("rid", rid);
    url.searchParams.set("redirectOrigin", redirectOrigin);

    this.popUp = createPopUp(url.toString());
    if (!this.popUp) {
      throw new Error("Popup blocked. Please enable popups.");
    }

    return { rid, redirectOrigin };
  }

  async sendPayloadToProvider({
    rid,
    timeoutMs = DEFAULT_TIMEOUT,
    signal,
  }: {
    rid: string;
    signal: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ rid: string }> {
    if (typeof window === "undefined") {
      throw new Error("Provider can only be used in a browser environment");
    }

    if (this.pending.size > 0) {
      throw new Error("An authorization flow is already in progress");
    }

    return new Promise<{ rid: string }>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const entry = this.pending.get(rid);
        if (!entry) return;

        if (entry.cancel) {
          entry.cancel(new Error("Authentication timed out"));
        } else {
          this.pending.delete(rid);
          reject(new Error("Authentication timed out"));
        }
      }, timeoutMs);

      if (!this.popUp || this.popUp.closed) {
        throw new Error("Popup is not open. Call createNewPopup() first.");
      }
      this.pending.set(rid, { rid, resolve, reject, timeoutId });

      this.attachTransport({
        popup: this.popUp,
        origin: new URL(this.providerOrigin).origin,
        rid,
        signal,
      });
    });
  }

  private attachTransport(params: {
    popup: Window;
    origin: string;
    rid: string;
    signal: AbortSignal;
  }) {
    const { popup, origin, rid, signal } = params;

    const entry = this.pending.get(rid);
    if (!entry) return;

    let port: MessagePort | null = null;
    let finished = false;

    const onAbort = (): void => {
      fail(new Error("Aborted"));
    };

    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
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
      this.pending.delete(rid);
      cleanup();
      entry.reject(err);
    };

    const succeed = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timeoutId);
      this.pending.delete(rid);
      cleanup();
      entry.resolve({ rid });
    };

    entry.cancel = fail;

    if (signal.aborted) {
      fail(new Error("Aborted"));
      return;
    }
    signal.addEventListener("abort", onAbort);

    const heartbeatId = setInterval(() => {
      if (!popup?.closed) return;
      fail(new Error("Popup was closed by the user"));
    }, HEARTBEAT_INTERVAL);

    const onConnect = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== popup) return;

      const data = event.data as PopupConnectMessage;
      if (!data || data.type !== "popup-connect" || data.rid !== rid) return;
      if (!event.ports?.[0]) return;

      port = event.ports[0];
      port.start();

      port.postMessage({ type: "popup-init" });

      port.onmessage = (ev: MessageEvent<PopupPortMessage>): void => {
        switch (ev.data.type) {
          case "popup-complete":
            succeed();
            break;

          case "popup-error":
            fail(new Error(ev.data.error));
            break;

          case "popup-closed": {
            fail(new Error("Lost connection with the popup."));
            break;
          }
        }
      };

      window.removeEventListener("message", onConnect);
    };

    window.addEventListener("message", onConnect);
  }
}

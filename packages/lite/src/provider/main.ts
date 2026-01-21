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

/**
 * RevibaseProvider handles the communication between the client application
 * and the Revibase authentication provider using popup windows and MessageChannel.
 */
export class RevibaseProvider {
  private readonly pending = new Map<string, Pending>();
  public readonly onClientAuthorizationCallback: ClientAuthorizationCallback;
  private readonly providerOrigin: string;
  private popUp: Window | null = null;

  constructor(opts: Options) {
    this.onClientAuthorizationCallback = opts.onClientAuthorizationCallback;
    this.providerOrigin = opts.providerOrigin ?? REVIBASE_AUTH_URL;
  }

  /**
   * Opens a blank popup window for authentication.
   * The popup will be reused for subsequent navigation.
   *
   * @throws {Error} If popup is blocked by the browser
   */
  openBlankPopUp(): void {
    this.popUp = createPopUp();
    if (!this.popUp) {
      throw new Error("Popup blocked. Please enable popups.");
    }
  }

  /**
   * Sends a payload to the provider and waits for the response.
   * Opens a popup window and handles communication via MessageChannel with polling fallback.
   *
   * @param rid - Request Id
   * @param timeoutMs - Timeout in milliseconds (defaults to DEFAULT_TIMEOUT)
   * @returns The response from the provider
   * @throws {Error} If called outside browser, if another flow is in progress, or if timeout occurs
   */
  async sendPayloadToProvider({
    rid,
    timeoutMs = DEFAULT_TIMEOUT,
  }: {
    rid: string;
    timeoutMs?: number;
  }): Promise<{ rid: string }> {
    if (typeof window === "undefined") {
      throw new Error("Provider can only be used in a browser environment");
    }

    if (this.pending.size > 0) {
      throw new Error("An authorization flow is already in progress");
    }

    const url = new URL(this.providerOrigin);
    url.searchParams.set("rid", rid);
    url.searchParams.set("redirectOrigin", window.location.origin);

    return new Promise<{ rid: string }>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const entry = this.pending.get(rid);
        if (!entry) return;

        // Route through unified cleanup path if available
        if (entry.cancel) {
          entry.cancel(new Error("Authentication timed out"));
        } else {
          this.pending.delete(rid);
          reject(new Error("Authentication timed out"));
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
    let closeHandled = false;

    const cleanup = (): void => {
      window.removeEventListener("message", onConnect);

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

    const succeed = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timeoutId);
      this.pending.delete(rid);
      cleanup();
      entry.resolve({ rid });
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
            throw new Error("Unable to navigate popup to provider URL");
          }
        }
      }

      if (!popup) {
        throw new Error("Popup blocked. Please enable popups.");
      }
      return popup;
    };

    // --- Start: open popup + require navigation
    try {
      popup = ensurePopupOpenedAndNavigated();
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    // Detect user closing popup
    const heartbeatId = setInterval(() => {
      if (!popup?.closed) return;
      if (closeHandled) return;
      closeHandled = true;
      fail(new Error("Popup was closed by the user"));
    }, HEARTBEAT_INTERVAL);

    const onConnect = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== popup) return;

      const data = event.data as PopupConnectMessage;
      if (data?.type !== "popup-connect") return;
      if (data.rid !== rid) return;
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

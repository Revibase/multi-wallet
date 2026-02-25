import { getBase64Decoder } from "gill";
import type { ClientAuthorizationCallback } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import {
  RevibaseAbortedError,
  RevibaseAuthError,
  RevibaseEnvironmentError,
  RevibaseFlowInProgressError,
  RevibasePopupBlockedError,
  RevibasePopupClosedError,
  RevibasePopupNotOpenError,
  RevibaseTimeoutError,
} from "src/utils/errors";
import { DeviceKeyManager } from "./device";
import {
  createPopUp,
  DEFAULT_TIMEOUT,
  HEARTBEAT_INTERVAL,
  type Pending,
  type PopupConnectMessage,
  type PopupPortMessage,
} from "./utils";
import {
  createSenderChannelSocket,
  type SenderChannelSocketHandle,
} from "./websocket";

/** Channel lifecycle status for device-bound flows. */
export enum ChannelStatus {
  AUTHENTICATING,
  AWAITING_RECIPIENT,
  RECIPIENT_CONNECTED,
  CHANNEL_CLOSED,
  ERROR,
}

/** Status update for a channel (status, optional recipient, optional error). */
export type ChannelStatusEntry = {
  status: ChannelStatus;
  recipient?: string;
  error?: string;
};

/** Listener for channel status updates. Called with (channelId, entry). */
export type ChannelStatusListener = (
  channelId: string,
  entry: ChannelStatusEntry,
) => void;

/**
 * Connects your app to the Revibase auth popup and your backend route.
 * For device-bound flows, use createChannel() and pass `{ channelId }` in options to signIn/transferTokens/executeTransaction.
 */
export class RevibaseProvider {
  private readonly pending = new Map<string, Pending>();
  public onClientAuthorizationCallback: ClientAuthorizationCallback;
  private readonly providerOrigin: string;
  private popUp: Window | null = null;
  private channelWs = new Map<string, SenderChannelSocketHandle>();
  private readonly channelStatusListeners = new Set<ChannelStatusListener>();
  private readonly logger: Pick<Console, "info" | "warn" | "error">;

  private defaultCallback: ClientAuthorizationCallback = async (
    request,
    signal,
    device,
    channelId,
  ) => {
    const res = await fetch("/api/clientAuthorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request, device, channelId }),
      signal,
    });
    const data = await res.json();
    if (!res.ok)
      throw new RevibaseAuthError(
        (data as { error?: string }).error ?? "Authorization failed",
      );
    return data;
  };

  /**
   * @param providerOrigin - Revibase auth origin. Defaults to production.
   * @param onClientAuthorizationCallback - Optional. Called with (request, signal, device, channelId). POST to your backend and return JSON. Pass signal to fetch for cancellation.
   * @param logger - Optional. { info, warn, error } for channel status and errors. No-op by default.
   */
  constructor(
    providerOrigin?: string,
    onClientAuthorizationCallback?: ClientAuthorizationCallback,
    logger?: Pick<Console, "info" | "warn" | "error">,
  ) {
    this.onClientAuthorizationCallback =
      onClientAuthorizationCallback ?? this.defaultCallback;
    this.providerOrigin = providerOrigin ?? REVIBASE_AUTH_URL;
    this.logger = logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  /** Returns device proof (jwk + jws) for the given message. Used when authorizing with a channel. */
  async getDeviceSignature(message: string) {
    return {
      jwk: (await DeviceKeyManager.getOrCreateDevicePublickey()).publicKey,
      jws: await DeviceKeyManager.sign(new TextEncoder().encode(message)),
    };
  }

  /** Subscribe to channel status updates. Returns an unsubscribe function. */
  subscribeToChannelStatus(listener: ChannelStatusListener): () => void {
    this.channelStatusListeners.add(listener);
    return () => {
      this.channelStatusListeners.delete(listener);
    };
  }

  private setChannelStatus(
    channelId: string,
    details: ChannelStatusEntry,
  ): void {
    for (const listener of this.channelStatusListeners) {
      try {
        listener(channelId, details);
      } catch (err) {
        this.logger.error(
          "[RevibaseProvider] Channel status listener threw",
          err,
        );
      }
    }
  }

  /** Creates a channel and WebSocket. Open the returned url in a new tab for the user to complete the handshake. */
  async createChannel(): Promise<{ channelId: string; url: string }> {
    const res = await fetch(`${this.providerOrigin}/api/channel/challenge`);
    if (!res.ok) {
      const data = await res.json();
      throw new RevibaseAuthError(
        (data as { error?: string }).error ?? "Unable to generate challenge",
      );
    }
    const { id, challenge } = await res.json();
    const device = {
      jwk: (await DeviceKeyManager.getOrCreateDevicePublickey()).publicKey,
      jws: await DeviceKeyManager.sign(new TextEncoder().encode(challenge)),
    };
    const response = await fetch(`${this.providerOrigin}/api/channel/create`, {
      method: "POST",
      body: JSON.stringify({
        device,
        challengeId: id,
      }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new RevibaseAuthError(
        (data as { error?: string }).error ?? "Unable to create channel",
      );
    }
    const { channelId } = await response.json();
    const handlers = createSenderChannelSocket({
      channelId,
      getDevicePayload: this.getDeviceSignature,
      providerOrigin: this.providerOrigin,
      callbacks: {
        onAwaitingRecipient: () =>
          this.setChannelStatus(channelId, {
            status: ChannelStatus.AWAITING_RECIPIENT,
          }),
        onRecipientConnected: ({ devicePublicKey }) =>
          this.setChannelStatus(channelId, {
            status: ChannelStatus.RECIPIENT_CONNECTED,
            recipient: devicePublicKey,
          }),
        onClose: () => {
          this.setChannelStatus(channelId, {
            status: ChannelStatus.CHANNEL_CLOSED,
          });
          this.channelWs.delete(channelId);
        },
        onError: (error) =>
          this.setChannelStatus(channelId, {
            status: ChannelStatus.ERROR,
            error,
          }),
      },
    });
    this.channelWs.set(channelId, handlers);
    this.setChannelStatus(channelId, { status: ChannelStatus.AUTHENTICATING });
    return { channelId, url: `${this.providerOrigin}?channelId=${channelId}` };
  }

  /** Cancels any pending request on the given channel (e.g. waiting for recipient). No-op if none. */
  cancelChannelRequest(channelId: string): void {
    this.channelWs.get(channelId)?.cancelRequest();
  }

  /** Closes the given channel (sends close over WebSocket and cleans up). */
  async closeChannel(channelId: string): Promise<void> {
    this.channelWs.get(channelId)?.closeChannel();
    this.channelWs.delete(channelId);
  }

  /** Closes all active channels. */
  async closeAllChannels(): Promise<void> {
    this.channelWs.entries().forEach((x) => x[1].closeChannel());
    this.channelWs.clear();
  }

  startRequest(channelId?: string) {
    const redirectOrigin = window.origin;
    const rid = getBase64Decoder().decode(
      crypto.getRandomValues(new Uint8Array(16)),
    );

    if (!channelId) {
      const url = new URL(this.providerOrigin);
      url.searchParams.set("rid", rid);
      url.searchParams.set("redirectOrigin", redirectOrigin);

      this.popUp = createPopUp(url.toString());
      if (!this.popUp) {
        throw new RevibasePopupBlockedError();
      }
    }

    return { rid, redirectOrigin };
  }

  async sendPayloadToProviderViaPopup({
    rid,
    timeoutMs = DEFAULT_TIMEOUT,
    signal,
  }: {
    rid: string;
    signal: AbortSignal;
    timeoutMs?: number;
  }) {
    if (typeof window === "undefined") {
      throw new RevibaseEnvironmentError();
    }

    if (this.pending.size > 0) {
      throw new RevibaseFlowInProgressError();
    }

    return new Promise<{ rid: string }>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const entry = this.pending.get(rid);
        if (!entry) return;

        if (entry.cancel) {
          entry.cancel(new RevibaseTimeoutError());
        } else {
          this.pending.delete(rid);
          reject(new RevibaseTimeoutError());
        }
      }, timeoutMs);

      if (!this.popUp || this.popUp.closed) {
        throw new RevibasePopupNotOpenError();
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
      fail(new RevibaseAbortedError());
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
      fail(new RevibaseAbortedError());
      return;
    }
    signal.addEventListener("abort", onAbort);

    const heartbeatId = setInterval(() => {
      if (!popup?.closed) return;
      fail(new RevibasePopupClosedError());
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

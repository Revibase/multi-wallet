import { initialize } from "@revibase/core";
import { getBase64Decoder } from "gill";
import type { ClientAuthorizationCallback } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
import {
  RevibaseAbortedError,
  RevibaseAuthError,
  RevibaseEnvironmentError,
  RevibasePopupBlockedError,
  RevibasePopupClosedError,
  RevibasePopupNotOpenError,
} from "src/utils/errors";
import { DeviceKeyManager } from "./device";
import { createPopUp, HEARTBEAT_INTERVAL } from "./utils";
import {
  createSenderChannelSocket,
  type SenderChannelSocketHandle,
} from "./websocket";

/** Channel status (subscribeToChannelStatus). */
export enum ChannelStatus {
  AUTHENTICATING,
  AWAITING_RECIPIENT,
  RECIPIENT_CONNECTED,
  RECIPIENT_DISCONNECTED,
  AUTO_RECONNECTING,
  CONNECTION_LOST,
  CHANNEL_CLOSED,
  ERROR,
}

/** status, recipient?, error?, reconnectAttempt? (when AUTO_RECONNECTING). */
export type ChannelStatusEntry = {
  status: ChannelStatus;
  recipient?: string;
  error?: string;
  reconnectAttempt?: number;
};

/** (channelId, entry) => void. */
export type ChannelStatusListener = (
  channelId: string,
  entry: ChannelStatusEntry,
) => void;

/** RevibaseProvider options. rpcEndpoint required for executeTransaction. */
export type RevibaseProviderOptions = {
  providerOrigin?: string;
  onClientAuthorizationCallback?: ClientAuthorizationCallback;
  rpcEndpoint?: string;
  logger?: Pick<Console, "info" | "warn" | "error">;
};

/** Provider: popup or channel auth. Default callback: POST /api/clientAuthorization. */
export class RevibaseProvider {
  public onClientAuthorizationCallback: ClientAuthorizationCallback;
  private readonly providerOrigin: string;
  private popUp: Window | null = null;
  private channelWs = new Map<string, SenderChannelSocketHandle>();
  private readonly channelStatusListeners = new Set<ChannelStatusListener>();
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private static CHANNEL_ID_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  private static CHANNEL_ID_LENGTH = 10;

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

  constructor(options: RevibaseProviderOptions = {}) {
    const {
      providerOrigin,
      onClientAuthorizationCallback,
      rpcEndpoint,
      logger,
    } = options;
    this.onClientAuthorizationCallback =
      onClientAuthorizationCallback ?? this.defaultCallback;
    this.providerOrigin = providerOrigin ?? REVIBASE_AUTH_URL;
    this.logger = logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    if (rpcEndpoint) {
      initialize({ rpcEndpoint });
    }
  }

  async getDeviceSignature(message: string) {
    return {
      jwk: (await DeviceKeyManager.getOrCreateDevicePublickey()).publicKey,
      jws: await DeviceKeyManager.sign(new TextEncoder().encode(message)),
    };
  }

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

  private generateChannelId() {
    let id = "";
    const len = RevibaseProvider.CHANNEL_ID_CHARSET.length;
    for (let i = 0; i < RevibaseProvider.CHANNEL_ID_LENGTH; i++) {
      id +=
        RevibaseProvider.CHANNEL_ID_CHARSET[Math.floor(Math.random() * len)];
    }
    return id;
  }

  async createChannel(): Promise<{ channelId: string; url: string }> {
    const channelId = this.generateChannelId();
    const device = await this.getDeviceSignature(channelId);
    const redirectOrigin = window.origin;
    await this.onClientAuthorizationCallback({
      phase: "start",
      redirectOrigin,
      data: { channelId, device, type: "channel" },
    });
    const handlers = createSenderChannelSocket({
      channelId,
      device,
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
        onRecipientDisconnected: () =>
          this.setChannelStatus(channelId, {
            status: ChannelStatus.RECIPIENT_DISCONNECTED,
          }),
        onClose: (_event, opts) => {
          if (opts?.connectionLost) {
            this.setChannelStatus(channelId, {
              status: ChannelStatus.CONNECTION_LOST,
            });
          } else {
            this.setChannelStatus(channelId, {
              status: ChannelStatus.CHANNEL_CLOSED,
            });
            this.channelWs.delete(channelId);
          }
        },
        onError: (error) =>
          this.setChannelStatus(channelId, {
            status: ChannelStatus.ERROR,
            error,
          }),
        onAutoReconnecting: (attempt) =>
          this.setChannelStatus(channelId, {
            status: ChannelStatus.AUTO_RECONNECTING,
            reconnectAttempt: attempt,
          }),
      },
    });
    this.channelWs.set(channelId, handlers);
    this.setChannelStatus(channelId, { status: ChannelStatus.AUTHENTICATING });
    return { channelId, url: `${this.providerOrigin}?channelId=${channelId}` };
  }

  cancelChannelRequest(channelId: string) {
    this.channelWs.get(channelId)?.cancelRequest();
  }

  reconnectChannel(channelId: string): boolean {
    return this.channelWs.get(channelId)?.reconnect() ?? false;
  }

  closeChannel(channelId: string) {
    this.channelWs.get(channelId)?.closeChannel();
    this.channelWs.delete(channelId);
  }

  closeAllChannels() {
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

  watchPopupClosed(
    signal: AbortSignal,
    onClosed: (err: Error) => void,
  ): () => void {
    if (typeof window === "undefined") {
      throw new RevibaseEnvironmentError();
    }

    if (!this.popUp || this.popUp.closed) {
      throw new RevibasePopupNotOpenError();
    }

    let stopped = false;
    const popup = this.popUp;

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      signal.removeEventListener("abort", onAbort);
      clearInterval(heartbeatId);
    };

    const onAbort = (): void => {
      stop();
      onClosed(new RevibaseAbortedError());
    };

    if (signal.aborted) {
      onClosed(new RevibaseAbortedError());
      return () => {};
    }
    signal.addEventListener("abort", onAbort);

    const heartbeatId = setInterval(() => {
      if (stopped) return;
      if (!popup || popup.closed) {
        stop();
        onClosed(new RevibasePopupClosedError());
      }
    }, HEARTBEAT_INTERVAL);

    return stop;
  }

  closePopup(): void {
    const popup = this.popUp;
    this.popUp = null;
    try {
      if (popup && !popup.closed) popup.close();
    } catch {}
  }
}

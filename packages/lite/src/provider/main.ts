import { getBase64Decoder } from "gill";
import type { ClientAuthorizationCallback } from "src/utils";
import { REVIBASE_AUTH_URL } from "src/utils/consts";
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

export enum ChannelStatus {
  AUTHENTICATING,
  AWAITING_RECIPIENT,
  RECIPIENT_CONNECTED,
  CHANNEL_CLOSED,
  ERROR,
}

export type ChannelStatusEntry = {
  status: ChannelStatus;
  recipient?: string;
  error?: string;
};

export type ChannelStatusListener = (
  channelId: string,
  entry: ChannelStatusEntry,
) => void;

export class RevibaseProvider {
  private readonly pending = new Map<string, Pending>();
  public onClientAuthorizationCallback: ClientAuthorizationCallback;
  private readonly providerOrigin: string;
  private popUp: Window | null = null;
  private channelWs = new Map<string, SenderChannelSocketHandle>();
  private readonly channelStatusListeners = new Set<ChannelStatusListener>();

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
      throw new Error(
        (data as { error?: string }).error ?? "Authorization failed",
      );
    return data;
  };

  constructor(
    onClientAuthorizationCallback?: ClientAuthorizationCallback,
    providerOrigin?: string,
  ) {
    this.onClientAuthorizationCallback =
      onClientAuthorizationCallback ?? this.defaultCallback;
    this.providerOrigin = providerOrigin ?? REVIBASE_AUTH_URL;
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
        console.error("[RevibaseProvider] Channel status listener threw", err);
      }
    }
  }

  async createChannel() {
    const res = await fetch(`${this.providerOrigin}/api/channel/challenge`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(
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
      throw new Error(
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

  cancelChannelRequest(channelId: string) {
    this.channelWs.get(channelId)?.cancelRequest();
  }

  closeChannel(channelId: string) {
    this.channelWs.get(channelId)?.closeChannel();
    this.channelWs.delete(channelId);
  }

  closeAllChannels() {
    this.channelWs.entries().forEach((x) => x[1].closeChannel());
    this.channelWs.clear();
  }

  startRequest(usePopUp: boolean) {
    const redirectOrigin = window.origin;
    const rid = getBase64Decoder().decode(
      crypto.getRandomValues(new Uint8Array(16)),
    );

    if (usePopUp) {
      const url = new URL(this.providerOrigin);
      url.searchParams.set("rid", rid);
      url.searchParams.set("redirectOrigin", redirectOrigin);

      this.popUp = createPopUp(url.toString());
      if (!this.popUp) {
        throw new Error("Popup blocked. Please enable popups.");
      }
    }

    return { rid, redirectOrigin };
  }

  async sendPayloadToProviderViaPopup({
    rid,
    timeoutMs = DEFAULT_TIMEOUT,
    signal,
    usePopUp,
  }: {
    rid: string;
    signal: AbortSignal;
    usePopUp: boolean;
    timeoutMs?: number;
  }) {
    if (!usePopUp) {
      return;
    }
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

import { z } from "zod";

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000;
const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 8_000;
const CHANNEL_WS_MAX_MESSAGE_BYTES = 64 * 1024;
const WS_CLOSE_CODE_AUTH_FAILED = 1008;
const WS_CLOSE_CODE_MESSAGE_TOO_LARGE = 1009;

function decodeMessageWithSizeLimit(
  data: string | ArrayBuffer,
  maxBytes: number,
): string | null {
  if (typeof data === "string") {
    const bytes = new TextEncoder().encode(data).length;
    return bytes <= maxBytes ? data : null;
  }
  if (data.byteLength > maxBytes) return null;
  return new TextDecoder().decode(data);
}

const SenderAwaitingRecipientSchema = z.object({
  event: z.literal("awaiting_recipient"),
});

const SenderRecipientConnectedSchema = z.object({
  event: z.literal("recipient_connected"),
  data: z.object({ devicePublicKey: z.string() }),
});

const SenderRecipientDisconnectedSchema = z.object({
  event: z.literal("recipient_disconnected"),
});

const SenderChannelWsMessageSchema = z.discriminatedUnion("event", [
  SenderAwaitingRecipientSchema,
  SenderRecipientConnectedSchema,
  SenderRecipientDisconnectedSchema,
]);

export type SenderChannelWsMessage = z.infer<
  typeof SenderChannelWsMessageSchema
>;

export type ChannelCloseOptions = {
  connectionLost?: boolean;
};

export type SenderChannelSocketCallbacks = {
  onAwaitingRecipient?: () => void;
  onRecipientConnected?: (data: { devicePublicKey: string }) => void;
  onRecipientDisconnected?: () => void;
  onClose?: (
    event: { code: number; reason: string; wasClean: boolean },
    opts?: ChannelCloseOptions,
  ) => void;
  onError?: (message: string) => void;
  onAutoReconnecting?: (attempt: number) => void;
  onConnected?: () => void;
};

export type SenderChannelSocketConfig = {
  providerOrigin: string;
  channelId: string;
  getDevicePayload: (channelId: string) => Promise<{
    jwk: string;
    jws: string;
  }>;
  callbacks: SenderChannelSocketCallbacks;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  authTimeoutMs?: number;
  maxMessageBytes?: number;
  verboseLogging?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
};

export type SenderChannelSocketHandle = {
  closeChannel: () => void;
  cancelRequest: () => boolean;
  reconnect: () => boolean;
};

function parseSenderIncomingMessage(
  data: string,
): SenderChannelWsMessage | null {
  try {
    const raw = JSON.parse(data) as unknown;
    const result = SenderChannelWsMessageSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function createSenderChannelSocket(
  config: SenderChannelSocketConfig,
): SenderChannelSocketHandle {
  const {
    providerOrigin,
    channelId,
    getDevicePayload,
    callbacks,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    reconnectBaseDelayMs = DEFAULT_RECONNECT_BASE_DELAY_MS,
    authTimeoutMs = DEFAULT_AUTH_TIMEOUT_MS,
    maxMessageBytes = CHANNEL_WS_MAX_MESSAGE_BYTES,
    verboseLogging = false,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  } = config;
  const {
    onAwaitingRecipient,
    onRecipientConnected,
    onRecipientDisconnected,
    onClose,
    onError,
    onAutoReconnecting,
    onConnected,
  } = callbacks;
  const providerUrl = new URL(providerOrigin);
  const protocol = providerUrl.protocol === "https:" ? "wss:" : "ws:";
  const host = providerUrl.host;
  const wsUrl = `${protocol}//${host}/api/channel/ws?channelId=${encodeURIComponent(channelId)}`;
  const log = config.logger ?? console;
  const HEARTBEAT_TIMEOUT_REASON = "Heartbeat timeout";

  log.info("[Channel WS Sender] Creating socket", { channelId, wsUrl });
  let currentWs: WebSocket = new WebSocket(wsUrl);
  let closed = false;
  let closedIntentionally = false;
  let connectionLost = false;
  let retryCount = 0;
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  let pendingPongTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let manualReconnectInProgress = false;

  function clearReconnectTimeout(): void {
    if (reconnectTimeoutId != null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  }

  function clearHeartbeat(): void {
    if (heartbeatIntervalId != null) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
    if (pendingPongTimeoutId != null) {
      clearTimeout(pendingPongTimeoutId);
      pendingPongTimeoutId = null;
    }
  }

  function closeSocket(code?: number, reason?: string): void {
    if (closed) return;
    closed = true;
    closedIntentionally = true;
    connectionLost = false;
    clearReconnectTimeout();
    clearHeartbeat();
    try {
      if (
        currentWs.readyState === WebSocket.OPEN ||
        currentWs.readyState === WebSocket.CONNECTING
      ) {
        currentWs.close(code ?? 1000, reason ?? "Closed");
      }
    } catch {}
  }

  async function getDevicePayloadWithTimeout(channelId: string): Promise<{
    jwk: string;
    jws: string;
  }> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Auth timeout")),
        authTimeoutMs,
      );
    });
    try {
      return await Promise.race([getDevicePayload(channelId), timeout]);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
    }
  }

  function attachHandlers(ws: WebSocket): void {
    ws.onopen = async (): Promise<void> => {
      if (closed || ws !== currentWs) return;
      log.info("[Channel WS Sender] Socket opened", { channelId });
      try {
        const device = await getDevicePayloadWithTimeout(channelId);
        if (closed || ws !== currentWs || ws.readyState !== WebSocket.OPEN)
          return;
        ws.send(JSON.stringify({ type: "auth", device }));
        log.info("[Channel WS Sender] Auth sent", { channelId });
        retryCount = 0;
        manualReconnectInProgress = false;
        onConnected?.();
        if (heartbeatIntervalMs > 0 && heartbeatTimeoutMs > 0) {
          heartbeatIntervalId = setInterval(() => {
            if (closed || currentWs.readyState !== WebSocket.OPEN) return;
            if (pendingPongTimeoutId != null) {
              log.warn("[Channel WS Sender] Heartbeat timeout", {
                channelId,
              });
              clearHeartbeat();
              try {
                currentWs.close(1000, HEARTBEAT_TIMEOUT_REASON);
              } catch {}
              return;
            }
            try {
              currentWs.send(JSON.stringify({ type: "ping" }));
            } catch {
              return;
            }
            pendingPongTimeoutId = setTimeout(() => {
              pendingPongTimeoutId = null;
              if (!closed) {
                log.warn("[Channel WS Sender] Heartbeat timeout", {
                  channelId,
                });
                clearHeartbeat();
                try {
                  currentWs.close(1000, HEARTBEAT_TIMEOUT_REASON);
                } catch {}
              }
            }, heartbeatTimeoutMs);
          }, heartbeatIntervalMs);
        }
      } catch (err) {
        log.error("Channel WebSocket (sender) auth failed", err, {
          channelId,
        });
        onError?.("Auth failed");
        closeSocket(WS_CLOSE_CODE_AUTH_FAILED, "Auth failed");
      }
    };

    ws.onmessage = (event: MessageEvent): void => {
      if (closed || ws !== currentWs) return;
      const raw = decodeMessageWithSizeLimit(
        event.data as string | ArrayBuffer,
        maxMessageBytes,
      );
      if (raw === null) {
        log.warn("[Channel WS Sender] Message too large or invalid", {
          channelId,
        });
        closedIntentionally = true;
        clearReconnectTimeout();
        try {
          ws.close(WS_CLOSE_CODE_MESSAGE_TOO_LARGE, "Message too large");
        } catch {}
        return;
      }
      try {
        const parsed = JSON.parse(raw) as { event?: string };
        if (parsed?.event === "pong") {
          if (pendingPongTimeoutId != null) {
            clearTimeout(pendingPongTimeoutId);
            pendingPongTimeoutId = null;
          }
          return;
        }
      } catch {}
      const msg = parseSenderIncomingMessage(raw);
      if (!msg) {
        if (verboseLogging) {
          log.info("[Channel WS Sender] Unparseable message", {
            channelId,
            preview: raw.slice(0, 100),
          });
        }
        return;
      }
      if (verboseLogging) {
        log.info("[Channel WS Sender] Message received", {
          channelId,
          event: msg.event,
          ...(msg.event !== "awaiting_recipient" &&
            msg.event !== "recipient_disconnected" && { data: msg.data }),
        });
      }
      if (msg.event === "awaiting_recipient") {
        onAwaitingRecipient?.();
      } else if (msg.event === "recipient_connected") {
        onRecipientConnected?.(msg.data);
      } else if (msg.event === "recipient_disconnected") {
        onRecipientDisconnected?.();
      }
    };

    ws.onclose = (event: CloseEvent): void => {
      if (ws !== currentWs) return;
      clearHeartbeat();
      const evt = {
        code: event.code,
        reason: event.reason || "",
        wasClean: event.wasClean,
      };
      const isHeartbeatClose = evt.reason === HEARTBEAT_TIMEOUT_REASON;

      const emitConnectionLost = () => {
        connectionLost = true;
        onClose?.(evt, { connectionLost: true });
      };
      const emitClose = () => onClose?.(evt);

      if (closed && !isHeartbeatClose) {
        if (manualReconnectInProgress) {
          manualReconnectInProgress = false;
          emitConnectionLost();
        } else {
          emitClose();
        }
        return;
      }
      if (isHeartbeatClose) {
        log.info("[Channel WS Sender] Socket closed (heartbeat timeout)", {
          channelId,
          code: evt.code,
          reason: evt.reason || "(none)",
          retryCount,
        });
      } else if (!closed) {
        log.info("[Channel WS Sender] Socket closed", {
          channelId,
          ...evt,
          retryCount,
        });
      }
      if (closedIntentionally) {
        closed = true;
        emitClose();
        return;
      }
      if (event.wasClean && !isHeartbeatClose) {
        closed = true;
        if (manualReconnectInProgress) {
          manualReconnectInProgress = false;
          emitConnectionLost();
        } else {
          emitClose();
        }
        return;
      }
      if (retryCount >= maxReconnectAttempts) {
        closed = true;
        log.info("[Channel WS Sender] Max reconnect attempts reached", {
          channelId,
          maxReconnectAttempts,
        });
        emitConnectionLost();
        return;
      }
      const baseDelay = reconnectBaseDelayMs * Math.pow(2, retryCount);
      const jitter = 0.8 + 0.4 * Math.random();
      const delay = Math.min(Math.round(baseDelay * jitter), 30_000);
      retryCount += 1;
      onAutoReconnecting?.(retryCount);
      log.info("[Channel WS Sender] Scheduling reconnect", {
        channelId,
        attempt: retryCount,
        delayMs: delay,
      });
      reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        if (closed) return;
        log.info("[Channel WS Sender] Reconnecting", {
          channelId,
          attempt: retryCount,
        });
        const prev = currentWs;
        currentWs = new WebSocket(wsUrl);
        try {
          if (
            prev.readyState === WebSocket.OPEN ||
            prev.readyState === WebSocket.CONNECTING
          ) {
            prev.close(1000, "Replaced by reconnect");
          }
        } catch {
          /* ignore */
        }
        attachHandlers(currentWs);
      }, delay);
    };

    ws.onerror = (): void => {
      if (ws !== currentWs) return;
      log.info("[Channel WS Sender] Socket error", { channelId });
      if (!closed) {
        onError?.("Connection error");
      }
    };
  }

  attachHandlers(currentWs);

  return {
    reconnect(): boolean {
      if (!connectionLost && !(reconnectTimeoutId != null && !closed)) {
        log.info("[Channel WS Sender] reconnect() no-op", {
          channelId,
          closed,
          connectionLost,
        });
        return false;
      }
      const hadScheduledRetry = reconnectTimeoutId != null;
      const wasConnectionLost = connectionLost;
      log.info("[Channel WS Sender] reconnect() starting", { channelId });
      closed = false;
      connectionLost = false;
      retryCount = 0;
      manualReconnectInProgress = hadScheduledRetry || wasConnectionLost;
      clearReconnectTimeout();
      clearHeartbeat();
      const previousWs = currentWs;
      currentWs = new WebSocket(wsUrl);
      try {
        if (
          previousWs.readyState === WebSocket.OPEN ||
          previousWs.readyState === WebSocket.CONNECTING
        ) {
          previousWs.close(1000, "Replaced by reconnect");
        }
      } catch {
        /* ignore */
      }
      attachHandlers(currentWs);
      return true;
    },
    closeChannel() {
      if (
        !closed &&
        !connectionLost &&
        currentWs.readyState === WebSocket.OPEN
      ) {
        try {
          log.info("[Channel WS Sender] Sending close", { channelId });
          currentWs.send(JSON.stringify({ type: "close" }));
        } catch (err) {
          log.error("Channel close send failed", err, { channelId });
          onError?.("Failed to close channel");
        }
      } else if (!closed) {
        log.info("[Channel WS Sender] closeChannel skip send", {
          channelId,
          closed,
          connectionLost,
          readyState: currentWs.readyState,
        });
      }
      if (closed) return;
      log.info("[Channel WS Sender] close() called", {
        channelId,
        connectionLost,
      });
      if (connectionLost) {
        closed = true;
        connectionLost = false;
        clearReconnectTimeout();
        onClose?.({ code: 1000, reason: "Closed", wasClean: true });
        return;
      }
      closeSocket();
    },
    cancelRequest(): boolean {
      if (closed || connectionLost || currentWs.readyState !== WebSocket.OPEN) {
        log.info("[Channel WS Sender] cancelRequest() skipped", {
          channelId,
          readyState: currentWs.readyState,
        });
        return false;
      }
      try {
        log.info("[Channel WS Sender] Sending cancel_request", {
          channelId,
        });
        currentWs.send(JSON.stringify({ type: "cancel_request" }));
        return true;
      } catch (err) {
        log.error("Channel (sender) cancel_request send failed", err, {
          channelId,
        });
        onError?.("Failed to cancel request");
        return false;
      }
    },
  };
}

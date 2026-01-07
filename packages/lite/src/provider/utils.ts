import type { ClientAuthorizationCallback } from "src/utils";

export type CallbackStatus = "ok" | "error" | "cancel";
export const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
export const HEARTBEAT_INTERVAL = 2000; // 2s
// How long to wait for MessageChannel connection before starting fallback polling
export const CONNECT_GRACE_MS = 3000; // 3s

// After a close signal, poll briefly to catch a persisted result, then fail.
export const CLOSE_POLL_GRACE_MS = 30000; // 30s

// Polling settings
export const POLL_INITIAL_DELAY_MS = 1000; // 1s
export const POLL_MAX_DELAY_MS = 4000; // 4s
export const POLL_BACKOFF = 1.7;
export type PopupPortMessage =
  | { type: "popup-complete"; payload: any }
  | { type: "popup-error"; error: string }
  | { type: "popup-closed" };
export type PopupConnectMessage = {
  type: "popup-connect";
  rid: string;
};
export type PollResponse =
  | { status: "timeout" }
  | { status: "pending" }
  | { status: "complete"; payload: any }
  | { status: "error"; error: string };

export type Options = {
  /**
   * Client Authorization Callback
   */
  onClientAuthorizationCallback: ClientAuthorizationCallback;
  /**
   * Origin of the authentication provider (e.g. https://auth.example.com).
   * Used to open and communicate with the authorization popup.
   */
  providerOrigin?: string;
  /**
   * Endpoint used to fetch the result as a fallback
   * when MessageChannel communication is unavailable or interrupted.
   */
  providerFetchResultUrl?: string;
};

export type Pending = {
  rid: string;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  cancel?: (err: Error) => void;
};

/**
 * Opens a popup window for WebAuthn or authentication workflows.
 *
 * This helper creates a centered, resizable popup on desktop, and a full-screen view on mobile.
 *
 * @param url - The URL to load in the popup.
 * @returns A reference to the newly created popup window, or `null` if blocked by the browser.
 *
 * @throws {Error} If called outside a browser environment.
 *
 */
export function createPopUp(url?: string) {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const availW = window.innerWidth || window.screen.availWidth;
  const availH = window.innerHeight || window.screen.availHeight;
  const isMobile = availW <= 768;

  let width: number;
  let height: number;
  let top: number;
  let left: number;

  if (isMobile) {
    width = availW;
    height = availH;
    top = 0;
    left = 0;
  } else {
    const screenLeft = window.screenLeft ?? window.screenX ?? 0;
    const screenTop = window.screenTop ?? window.screenY ?? 0;

    const viewportW =
      window.innerWidth ??
      document.documentElement.clientWidth ??
      window.screen.width;

    const viewportH =
      window.innerHeight ??
      document.documentElement.clientHeight ??
      window.screen.height;

    width = 500;
    height = 600;
    left = Math.round(screenLeft + (viewportW - width) / 2);
    top = Math.round(screenTop + (viewportH - height) / 2);
  }

  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `top=${top}`,
    `left=${left}`,
    "toolbar=no",
    "location=no",
    "status=no",
    "menubar=no",
    "scrollbars=yes",
    "resizable=yes",
  ].join(",");

  return window.open(url ?? "", "_blank", features);
}

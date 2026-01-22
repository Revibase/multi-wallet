import type { ClientAuthorizationCallback } from "src/utils";

export const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
export const HEARTBEAT_INTERVAL = 2000; // 2s

export type PopupPortMessage =
  | { type: "popup-complete"; payload: any }
  | { type: "popup-error"; error: string }
  | { type: "popup-closed" };

export type PopupConnectMessage = {
  type: "popup-connect";
  rid: string;
};

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
 * @param url - The URL to load in the popup (optional, can be set later)
 * @returns A reference to the newly created popup window, or `null` if blocked by the browser
 * @throws {Error} If called outside a browser environment
 */
export function createPopUp(url?: string): Window | null {
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

import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  UserInfo,
} from "@revibase/core";
import {
  RevibaseApiError,
  RevibaseAuthError,
  type ClientAuthorizationCallback,
  type OnConnectedCallback,
  type OnSuccessCallback,
} from "../utils";

export const DEFAULT_TIMEOUT = 3 * 60 * 1000;
export const HEARTBEAT_INTERVAL = 2000;
export const CONNECT_TIMEOUT = 20000;

export type PopupPortMessage =
  | { type: "pong" }
  | {
      type: "popup-complete";
      payload: CompleteTransactionRequest | CompleteMessageRequest;
    }
  | { type: "popup-rejected"; rid: string }
  | { type: "popup-error"; error: string }
  | { type: "popup-closed" };

export type PopupConnectMessage = {
  type: "popup-connect";
  rid: string;
};

export type Pending = {
  rid: string;
  clientOrigin: string;
  onConnectedCallback: OnConnectedCallback;
  onSuccessCallback: OnSuccessCallback;
  signal?: AbortSignal;
  resolve: (v: { user: UserInfo } | { user: UserInfo; txSig: string }) => void;
  reject: (e: Error) => void;
};

/** RevibaseProvider options. rpcEndpoint required for executeTransaction. */
export type RevibaseProviderOptions = {
  rpcEndpoint: string;
  providerOrigin?: string;
  rpId?: string;
  /** UI mode for same-device authorization. Default: "iframe". */
  ui?: {
    mode?: "popup" | "iframe";
    /**
     * Optional advanced hook to fully control how the provider UI is rendered.
     * Return a target window (popup or iframe.contentWindow) for postMessage transport,
     * and a close() function for cleanup. If you can, also provide isClosed() so the
     * SDK can detect user-dismissal.
     */
    render?: (url: string) => {
      targetWindow: Window;
      close: () => void;
      isClosed?: () => boolean;
    };
  };
  onClientAuthorizationCallback?: ClientAuthorizationCallback;
  onEstimateJitoTipsCallback?: () => Promise<number>;
  onSendJitoBundleCallback?: (request: string[]) => Promise<string>;
};

export const defaultSendJitoBundleCallback: (
  serializedTransactions: string[],
) => Promise<string> = async (request) => {
  const res = await fetch("/api/sendJitoBundle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new RevibaseApiError(
      (data as { error?: string }).error ?? "Send jito bundle failed",
    );
  }

  return data;
};

export const defaultEstimateJitoTipsCallback: () => Promise<number> =
  async () => {
    const res = await fetch("/api/estimateJitoTips");

    const data = await res.json();
    if (!res.ok) {
      throw new RevibaseApiError(
        (data as { error?: string }).error ?? "Estimate jito tips failed",
      );
    }

    return data;
  };

export const defaultClientAuthorizationCallback: ClientAuthorizationCallback =
  async (request) => {
    const res = await fetch("/api/clientAuthorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new RevibaseAuthError(
        (data as { error?: string }).error ?? "Authorization failed",
      );
    }

    return data;
  };

export function createPopUp(url: string): Window | null {
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

  return window.open(url, "_blank", features);
}
export interface ProviderFrame {
  iframe: HTMLIFrameElement;
  close: () => void;
}

export function createProviderFrame(
  url: string,
  signal?: AbortSignal,
  onDismiss?: () => void,
): ProviderFrame {
  if (typeof window === "undefined") {
    throw new Error("Function can only be called in a browser environment");
  }

  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  // ----------------------------------------
  // Scroll lock (iOS-safe)
  // ----------------------------------------

  const scrollY = window.scrollY;

  const previousBodyStyles = {
    overflow: document.body.style.overflow,
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    right: document.body.style.right,
    width: document.body.style.width,
  };

  const lockScroll = () => {
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  };

  const unlockScroll = () => {
    document.body.style.overflow = previousBodyStyles.overflow;
    document.body.style.position = previousBodyStyles.position;
    document.body.style.top = previousBodyStyles.top;
    document.body.style.left = previousBodyStyles.left;
    document.body.style.right = previousBodyStyles.right;
    document.body.style.width = previousBodyStyles.width;

    window.scrollTo(0, scrollY);
  };

  lockScroll();

  // ----------------------------------------
  // Shadow DOM host
  // ----------------------------------------

  const host = document.createElement("div");

  host.setAttribute("data-provider-frame-root", "true");

  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
    contain: "layout style paint",
  });

  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  // ----------------------------------------
  // Overlay
  // ----------------------------------------

  const overlay = document.createElement("div");

  Object.assign(overlay.style, {
    all: "initial",

    position: "fixed",
    inset: "0",

    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",

    background: "rgba(0,0,0,0.45)",

    zIndex: "2147483647",

    pointerEvents: "auto",

    overscrollBehavior: "contain",
    touchAction: "none",

    WebkitTapHighlightColor: "transparent",

    paddingBottom: "env(safe-area-inset-bottom)",

    fontFamily:
      'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });

  shadow.appendChild(overlay);

  // ----------------------------------------
  // Frame wrapper
  // ----------------------------------------

  const frameWrapper = document.createElement("div");

  Object.assign(frameWrapper.style, {
    all: "initial",

    position: "relative",

    display: "flex",

    width: isMobile ? "100%" : "500px",

    height: isMobile ? "90dvh" : "600px",

    maxWidth: "100vw",
    maxHeight: "100dvh",

    borderRadius: isMobile ? "16px 16px 0 0" : "16px",

    overflow: "hidden",

    boxShadow: "0 24px 80px rgba(0,0,0,0.35)",

    background: "#fff",

    pointerEvents: "auto",
  });

  overlay.appendChild(frameWrapper);

  // ----------------------------------------
  // iframe
  // ----------------------------------------

  const iframe = document.createElement("iframe");

  iframe.src = url;

  iframe.title = "Authorization";

  iframe.setAttribute("tabindex", "0");

  iframe.allow = [`publickey-credentials-get ${new URL(url).origin}`].join(
    "; ",
  );

  iframe.sandbox = ["allow-scripts", "allow-same-origin"].join(" ");

  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",

    border: "0",

    background: "#fff",

    display: "block",
  });

  frameWrapper.appendChild(iframe);

  // ----------------------------------------
  // Close button
  // ----------------------------------------

  const closeBtn = document.createElement("button");

  closeBtn.type = "button";

  closeBtn.setAttribute("aria-label", "Close");

  closeBtn.innerHTML = "&times;";

  Object.assign(closeBtn.style, {
    all: "initial",

    position: "absolute",

    top: isMobile ? "12px" : "14px",
    right: isMobile ? "12px" : "14px",

    width: "44px",
    height: "44px",

    display: "grid",
    placeItems: "center",

    borderRadius: "9999px",

    background: "rgba(255,255,255,0.96)",

    color: "#111",

    fontSize: "28px",

    lineHeight: "1",

    cursor: "pointer",

    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",

    zIndex: "2",

    userSelect: "none",
    WebkitUserSelect: "none",
  });

  frameWrapper.appendChild(closeBtn);

  // ----------------------------------------
  // Focus iframe
  // ----------------------------------------

  requestAnimationFrame(() => {
    try {
      iframe.focus();
    } catch {}
  });

  // ----------------------------------------
  // Escape key
  // ----------------------------------------

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      dismiss();
    }
  };

  document.addEventListener("keydown", keyHandler);

  // ----------------------------------------
  // Close logic
  // ----------------------------------------

  let closed = false;

  const close = () => {
    if (closed) return;

    closed = true;

    try {
      signal?.removeEventListener("abort", abortHandler);
    } catch {}

    try {
      document.removeEventListener("keydown", keyHandler);
    } catch {}

    try {
      iframe.src = "about:blank";
      iframe.removeAttribute("src");
    } catch {}

    try {
      host.remove();
    } catch {}

    unlockScroll();
  };

  // ----------------------------------------
  // Dismiss
  // ----------------------------------------

  const dismiss = () => {
    onDismiss?.();
    close();
  };

  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    dismiss();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      dismiss();
    }
  });

  // ----------------------------------------
  // Abort signal
  // ----------------------------------------

  const abortHandler = () => {
    dismiss();
  };

  if (signal) {
    if (signal.aborted) {
      abortHandler();
    } else {
      signal.addEventListener("abort", abortHandler, {
        once: true,
      });
    }
  }

  return {
    iframe,
    close,
  };
}

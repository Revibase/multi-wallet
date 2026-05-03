import type {
  CompleteMessageRequest,
  CompleteTransactionRequest,
  StartMessageRequest,
  StartTransactionRequest,
} from "@revibase/core";
import {
  RevibaseApiError,
  RevibaseAuthError,
  type ClientAuthorizationCallback,
} from "src/utils";

export const DEFAULT_TIMEOUT = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL = 2000;

export type PopupPortMessage =
  | {
      type: "popup-complete";
      payload: CompleteTransactionRequest | CompleteMessageRequest;
    }
  | { type: "popup-error"; error: string }
  | { type: "popup-closed" };

export type PopupConnectMessage = {
  type: "popup-connect";
  rid: string;
};

export type Pending = {
  request: StartMessageRequest | StartTransactionRequest;
  signature: string;
  resolve: (v: CompleteMessageRequest | CompleteTransactionRequest) => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  cancel?: (err: Error) => void;
};

/** RevibaseProvider options. rpcEndpoint required for executeTransaction. */
export type RevibaseProviderOptions = {
  rpcEndpoint: string;
  providerOrigin?: string;
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

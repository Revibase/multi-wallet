import type { WalletIcon } from "@wallet-standard/base";

/**
 * Inline (data-URI) wallet icon shown in dApp wallet pickers. Kept as an SVG
 * data URI so the package has no binary assets and works in any bundler.
 * Replace with the official Revibase brand mark when available.
 */
export const REVIBASE_ICON: WalletIcon =
  `data:image/svg+xml;base64,${btoaUtf8(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" rx="14" fill="#0B0B0F"/>` +
      `<path d="M20 44V20h13c6 0 10 3.6 10 9 0 3.8-2 6.6-5.3 8L44 44h-7l-5.4-6.4H27V44h-7Zm7-12.4h5.4c2.4 0 3.8-1.3 3.8-3.3s-1.4-3.3-3.8-3.3H27v6.6Z" fill="#fff"/>` +
      `</svg>`,
  )}` as WalletIcon;

/** Minimal, environment-agnostic UTF-8 safe base64 encoder. */
function btoaUtf8(input: string): string {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(input)));
  }
  // Node fallback (used in tests / SSR)
  return Buffer.from(input, "utf-8").toString("base64");
}

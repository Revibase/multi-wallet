import assert from "node:assert/strict";

// Stub a minimal browser `window` so @wallet-standard/app can wire up its
// register/discover event handshake in Node. EventTarget supplies
// addEventListener / removeEventListener / dispatchEvent; CustomEvent is global
// in Node 19+.
globalThis.window = /** @type {any} */ (new EventTarget());

const { getWallets } = await import("@wallet-standard/app");
const { registerRevibaseWallet } = await import("../dist/index.js");

const wallets = getWallets();
assert.ok(
  !wallets.get().some((w) => w.name === "Revibase"),
  "Revibase not present before registration",
);

// Stub provider — registration/discovery never touches it.
registerRevibaseWallet(/** @type {any} */ ({}));

const found = wallets.get().find((w) => w.name === "Revibase");
assert.ok(found, "Revibase discoverable via getWallets() after registration");
assert.ok(
  found.features["solana:signAndSendTransaction"],
  "discovered wallet exposes solana:signAndSendTransaction",
);
assert.ok(
  found.features["standard:connect"],
  "discovered wallet exposes standard:connect",
);

console.log("✓ register → getWallets() discovery passed");

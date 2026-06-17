# @revibase/wallet-standard

A [Wallet Standard](https://github.com/wallet-standard/wallet-standard) wrapper
around [`@revibase/lite`](../lite). Once a dApp registers it, Revibase appears in
that dApp's wallet picker through the standard
`registerWallet()` → `getWallets()` mechanism — the same registry the Mobile
Wallet Adapter entry uses — on both **desktop and mobile web**. dApps built on
`@solana/wallet-adapter`, wallet-standard modals, or framework-kit ConnectorKit
then connect to it like any other wallet.

> **This is opt-in per dApp, not auto-injected.** Unlike an extension wallet
> (Phantom, Solflare) that injects itself on every page, Revibase is an npm
> package. It only shows up in dApps that bundle this package **and** complete
> the backend setup below. See [Setup](#setup) and
> [How authorization works](#how-authorization-works).

```bash
pnpm add @revibase/wallet-standard @revibase/lite
```

Peer dependencies (provided by the host app, deduped to one copy):
`@wallet-standard/base`, `@wallet-standard/features`,
`@solana/wallet-standard-features`, `@solana/wallet-standard-chains`.

## Quick start (checklist)

1. **Generate keys** locally — one terminal command, no signup (Step 1).
2. **Publish** `/.well-known/revibase.json` (public key + app title/description) at your origin.
3. **Add a backend** route `POST /api/clientAuthorization` (uses your private key).
4. **Register** the wallet on the frontend: `registerRevibaseWallet(new RevibaseProvider({ rpcEndpoint }))`.

That's it — "Revibase" then shows up in your wallet picker. Details below.

## Setup

Integrating the Revibase wallet has **two layers**. Both are required — even
connecting (passkey sign-in) goes through your backend.

### Step 1 — Generate keys (one-time, local)

Generate your own **Ed25519 / EdDSA** client keypair in your terminal — no
signup, no external service. Save as `gen-keys.mjs` and run `node gen-keys.mjs`:

```js
// gen-keys.mjs — uses only Node built-ins, no dependencies
import { generateKeyPairSync } from "node:crypto";

const alg = "EdDSA";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const b64 = (key) =>
  Buffer.from(
    JSON.stringify({ ...key.export({ format: "jwk" }), alg, use: "sig" }),
  ).toString("base64");

console.log("PRIVATE_KEY=" + b64(privateKey)); // keep secret, server-only
console.log("PUBLIC_KEY=" + b64(publicKey)); // safe to publish
```

It prints two base64 strings:

- **`PRIVATE_KEY`** — server-only env var; signs authorization requests (Step 3).
  Never expose it to the browser or commit it.
- **`PUBLIC_KEY`** — backend env var; you also publish it (Step 2).

### Step 2 — Publish `/.well-known/revibase.json`

Serve this at your app's origin (e.g. `https://your-app.com/.well-known/revibase.json`).
Revibase's auth UI fetches it to verify requests really came from your origin and
to show users *which app* is asking for approval.

```json
{
  "clientJwk": "<your PUBLIC_KEY from Step 1>",
  "title": "Your App",
  "description": "Short description shown in the approval prompt"
}
```

### Step 3 — Backend endpoint `POST /api/clientAuthorization`

Keep `PRIVATE_KEY` server-only. Install the WebAuthn verifier alongside the SDK:
`pnpm add @revibase/lite @simplewebauthn/server`.

```ts
// app/api/clientAuthorization/route.ts (Next.js example)
import { processClientAuthCallback } from "@revibase/lite/server";

export async function POST(req: Request) {
  try {
    const result = await processClientAuthCallback({
      request: await req.json(),
      publicKey: process.env.PUBLIC_KEY!,            // Revibase client public key (base64)
      privateKey: process.env.PRIVATE_KEY!,          // your private key — server-only
      allowedClientOrigins: [process.env.CLIENT_ORIGIN!], // e.g. "https://your-app.com"
    });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
```

See the [`@revibase/lite` README](../lite/README.md) for the full backend
reference (including the optional Jito endpoints used by `executeTransaction`).

### Step 4 — Register the wallet (frontend)

```ts
import { RevibaseProvider } from "@revibase/lite";
import { registerRevibaseWallet } from "@revibase/wallet-standard";

const provider = new RevibaseProvider({
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
});

// Call once at startup. Order vs. your wallet-adapter mount doesn't matter —
// registerWallet dispatches an event the app listens for either way.
// By default the provider POSTs to YOUR /api/clientAuthorization (same origin).
registerRevibaseWallet(provider);
```

"Revibase" now appears in the wallet picker. Selecting it triggers the passkey
sign-in popup/iframe; transactions are approved with the passkey and broadcast
by Revibase.

## How authorization works

Revibase ties each request to your app's origin via the keypair from Step 1:

1. The frontend (`RevibaseProvider`) POSTs the request to your
   `/api/clientAuthorization`.
2. Your backend signs the request challenge as a JWS with your **private key**
   and rejects any `clientOrigin` not in `allowedClientOrigins`.
3. `auth.revibase.com` fetches `your-origin/.well-known/revibase.json`, verifies
   the JWS against your **public key**, and shows the user your app's title +
   description before they approve with their passkey.

This is why a dApp that imports the adapter but skips Steps 1–3 will still show
"Revibase" in its picker, but every operation fails at `/api/clientAuthorization`.

### Options

```ts
registerRevibaseWallet(provider, {
  name: "Revibase",            // display name
  icon: "data:image/svg+xml;base64,...", // custom data-URI icon
  chains: ["solana:mainnet"],  // defaults to mainnet + devnet
});
```

## Supported features

| Feature | Supported | Notes |
| ------- | --------- | ----- |
| `standard:connect` | ✅ | Runs Revibase passkey sign-in, exposes the vault account |
| `standard:disconnect` | ✅ | Clears the connected account |
| `standard:events` | ✅ | Emits `change` when accounts change |
| `solana:signAndSendTransaction` | ✅ | Rebuilds as a vault-paid tx, signs with passkey, broadcasts |
| `solana:signTransaction` | ❌ | Not possible — see Constraints |
| `solana:signMessage` | ❌ | Incompatible by design — ed25519-only output, see Constraints |
| `solana:signIn` (SIWS) | ❌ | Incompatible by design — ed25519-only output, see Constraints |

## Constraints (read this)

These come from Revibase's architecture, not the wrapper:

- **No raw `signTransaction`.** A Revibase approval is a secp256r1/WebAuthn proof
  consumed **on-chain** by the `multi_wallet` program — not an ed25519 signature
  over the wire. There is no signed-but-unsent transaction to hand back, so only
  `solana:signAndSendTransaction` is offered. dApps that strictly require
  sign-only will skip Revibase gracefully.
- **The dApp's fee payer / blockhash are replaced.** `executeTransaction` rebuilds
  the transaction with the Revibase vault as payer and its own fee payer/blockhash.
  The wrapper decodes the incoming serialized transaction back into instructions
  (resolving address lookup tables via RPC) and feeds those instructions to
  Revibase. Anything the dApp encoded in the fee payer/blockhash is discarded.
- **`account.address` is the vault** (`UserInfo.walletAddress`), a PDA — not an
  ed25519 key. `account.publicKey` is the decoded address bytes; don't ed25519-verify
  against it.
- **`solana:signIn` / `solana:signMessage` are intentionally omitted — permanently.**
  These features exist so a dApp can verify a signature **off-chain against the
  account's key**, and the Wallet Standard types hardcode that to ed25519
  (`signatureType?: 'ed25519'`, and "if not provided, the signature must be
  Ed25519"). Revibase is fundamentally incompatible with that model:
  - **Curve:** the passkey signs with **secp256r1**, so `ed25519.verify(...)` fails.
  - **Envelope:** WebAuthn does not sign the raw message — it signs
    `authenticatorData ‖ sha256(clientDataJSON)` (the message is the embedded
    challenge), so the signature won't verify against the returned `signedMessage`
    bytes even with a secp256r1 verifier.
  - **Key:** the verifying key is the passkey's secp256r1 public key, not
    `account.publicKey` (the vault PDA).

  Revibase instead authenticates the user via the passkey through its own backend
  (`/api/clientAuthorization`). dApps that prefer SIWS simply fall back to
  `standard:connect`, which is the correct behavior here.

## Public API

- `registerRevibaseWallet(provider, options?) => RevibaseWallet` — register and return the wallet.
- `RevibaseWallet` — the Wallet Standard wallet class (construct directly for custom registration).
- `RevibaseWalletAccount` — the account type backing a connected vault.
- `decompileTransactionToInstructions(serializedTx, rpc)` — helper used internally; exported for reuse/testing.
- `REVIBASE_ICON` — the default data-URI icon.

## Tests

Headless checks live in `test/` (run with Node after `pnpm build`):

```bash
pnpm build
node test/verify.mjs    # wallet object shape + decompile round-trip
node test/discover.mjs  # registerRevibaseWallet -> getWallets() discovery
```

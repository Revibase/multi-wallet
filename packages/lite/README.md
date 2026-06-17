# @revibase/lite

Passkey Solana wallet: sign in and approve transactions in an **iframe overlay (default)** or **popup (opt-in)**. Backend authorizes with a server-side private key.

```bash
pnpm add @revibase/lite
```

Frontend: import from `@revibase/lite`. Backend: import server helpers from `@revibase/lite/server` (requires `@simplewebauthn/server` on the server). See [AGENTS.md](./AGENTS.md) for the full export list.

---

## Get started

**Timeouts:** flows expire after **3 minutes** by default. Use flow option `signal` to abort early.

### 1. Keys

Generate your own client keypair (an **Ed25519 / EdDSA** JWK pair) in your terminal — no account or signup needed. Save this as `gen-keys.mjs` and run `node gen-keys.mjs`:

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

This prints two base64 strings:

- **`PRIVATE_KEY`** — set as a server-only env var (signs authorization requests). Never expose it to the browser or commit it.
- **`PUBLIC_KEY`** — set as an env var for the backend, and publish the same value at `/.well-known/revibase.json`.

Then serve `/.well-known/revibase.json` at your app's origin:

```json
{
  "clientJwk": "<your PUBLIC_KEY>",
  "title": "Your App",
  "description": "Short description shown in the approval prompt"
}
```

Revibase's auth UI fetches this file to verify requests came from your origin and to show users which app is asking for approval.

### 2. Backend

Expose **POST** at **`/api/clientAuthorization`**. Keep `PRIVATE_KEY` server-only.

Install WebAuthn server verification alongside the SDK:

```bash
pnpm add @revibase/lite @simplewebauthn/server
```

```ts
import {
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/lite";
import { processClientAuthCallback } from "@revibase/lite/server";

export async function POST(req: Request) {
  try {
    const request = (await req.json()) as
      | Omit<StartMessageRequest, "validTill">
      | Omit<StartTransactionRequest, "validTill">
      | CompleteMessageRequest
      | CompleteTransactionRequest;
    const result = await processClientAuthCallback({
      request,
      publicKey: process.env.PUBLIC_KEY!, // your PUBLIC_KEY from step 1 (base64)
      allowedClientOrigins: [process.env.CLIENT_ORIGIN!], // e.g. "https://your-app.com"
      privateKey: process.env.PRIVATE_KEY!,
    });
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
```

If you plan to send Jito bundles via `executeTransaction`, also implement:

- `POST /api/sendJitoBundle`
- `GET /api/estimateJitoTips`

### 3. Frontend

Create a provider (`rpcEndpoint` required), then call `signIn` / `transferTokens` / `executeTransaction`.

```ts
import {
  RevibaseProvider,
  signIn,
  transferTokens,
  executeTransaction,
} from "@revibase/lite";

const provider = new RevibaseProvider({
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
});
const { user } = await signIn(provider);
const { txSig } = await transferTokens(provider, {
  amount: BigInt(100_000_000),
  destination: "ADDRESS",
  signer: user, // optional for transfers
});
```

Custom instructions via `executeTransaction`:

```ts
import { RevibaseProvider, signIn, executeTransaction } from "@revibase/lite";
import { address, createNoopSigner } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

const provider = new RevibaseProvider({
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
});
const { user } = await signIn(provider);

const { txSig } = await executeTransaction(provider, {
  instructions: [
    getTransferSolInstruction({
      source: createNoopSigner(address(user.walletAddress)),
      destination: address("RECIPIENT_WALLET_ADDRESS"),
      amount: 1_000_000n,
    }),
  ],
  signer: user,
});
```

Default: iframe overlay.

### Popup mode (opt-in)

Use a popup instead of the default iframe:

```ts
const provider = new RevibaseProvider({
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
  ui: { mode: "popup" },
});
```

### When iframe mode can be unusable (use popup instead)

If embedded auth is flaky (passkey prompt doesn’t show, broken sessions, unresponsive UI), switch to popup (or provide `ui.render`), especially in:

- **In-app browsers / webviews** (e.g. links opened inside social apps): WebAuthn + storage policies can be incomplete or inconsistent.
- **Apps already embedded in an iframe** (nested iframes): privacy and permissions restrictions get stricter.
- **Apps with aggressive event/scroll locking**: touch/focus handling can interfere with an iframe overlay.

Your CSP must allow the provider origin in `frame-src` (or `child-src`) and must not block your configured `providerOrigin`.

### Iframe mode (best practice): render it yourself

For strict CSP / custom modals / theming, provide `ui.render`. Return the iframe `targetWindow` plus `close()` cleanup.

```ts
const provider = new RevibaseProvider({
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
  ui: {
    mode: "iframe",
    render: (url) => {
      const iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.allow = "publickey-credentials-get *";
      document.querySelector("#revibase-modal")!.appendChild(iframe);

      return {
        targetWindow: iframe.contentWindow!,
        close: () => iframe.remove(),
        isClosed: () => !iframe.isConnected,
      };
    },
  },
});
```

# @revibase/lite

Passkey Solana wallet: sign in and approve transactions in an **iframe overlay (default)** or **popup (opt-in)**. Backend authorizes with a server-side private key.

```bash
pnpm add @revibase/lite
```

Frontend: `RevibaseProvider`, `signIn`, `transferTokens`, `executeTransaction`. Backend: `processClientAuthCallback`. See [AGENTS.md](./AGENTS.md) for the full export list.

---

## Get started

**Timeouts:** flows expire after **3 minutes** by default. Use flow option `signal` to abort early.

### 1. Keys

Get keys at [developers.revibase.com](https://developers.revibase.com). Add `/.well-known/revibase.json` with `clientJwk`, `title`, `description`.

### 2. Backend

Expose **POST** at **`/api/clientAuthorization`**. Keep `PRIVATE_KEY` server-only.

```ts
import {
  processClientAuthCallback,
  type CompleteMessageRequest,
  type CompleteTransactionRequest,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/lite";

export async function POST(req: Request) {
  try {
    const request = (await req.json()) as
      | Omit<StartMessageRequest, "validTill">
      | Omit<StartTransactionRequest, "validTill">
      | CompleteMessageRequest
      | CompleteTransactionRequest;
    const result = await processClientAuthCallback({
      request,
      publicKey: process.env.PUBLIC_KEY!, // Revibase client public key (base64)
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
import { address, createNoopSigner } from "gill";
import { getTransferSolInstruction } from "gill/programs";

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

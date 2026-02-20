# @revibase/lite

Add **Revibase** (a passkey-based Solana wallet) to your app. Users sign in and approve transactions in a popup, while your backend authorizes requests with a private key that stays server-side.

## Quick Start

```bash
pnpm add @revibase/lite
```

### 1) Add well-known config

Create `/.well-known/revibase.json` (for example in `public/.well-known/revibase.json`):

```json
{
  "clientJwk": "<public-key-from-developers.revibase.com>",
  "title": "My App",
  "description": "Connect with passkeys"
}
```

### 2) Add backend route

Set `PRIVATE_KEY` to your matching private key, then forward the client payload to `processClientAuthCallback`:

```ts
import { processClientAuthCallback } from "@revibase/lite";

export async function POST(req: Request) {
  try {
    const { request, device, channelId } = (await req.json()) as {
      request: StartMessageRequest | StartTransactionRequest;
      device?: DeviceSignature;
      channelId?: string;
    };
    const result = await processClientAuthCallback({
      request,
      privateKey: process.env.PRIVATE_KEY!,
      signal: req.signal,
      device,
      channelId,
    });
    return new Response(JSON.stringify(result));
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500 },
    );
  }
}
```

### 3) Use in frontend

If your backend route is `/api/clientAuthorization`, the default provider is enough:

```ts
import { RevibaseProvider, signIn, transferTokens } from "@revibase/lite";

const provider = new RevibaseProvider();
const { user } = await signIn(provider);
const { txSig } = await transferTokens(provider, {
  amount: BigInt(100_000_000),
  destination: "RECIPIENT_ADDRESS",
  signer: user,
});
```

### 4) Optional: custom callback route

If your route path is different, pass a custom callback and forward `signal`:

```ts
import type { ClientAuthorizationCallback } from "@revibase/lite";
import { RevibaseProvider } from "@revibase/lite";

const onClientAuthorizationCallback: ClientAuthorizationCallback = async (
  request,
  signal,
  device,
  channelId,
) => {
  const res = await fetch("/api/revibase/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, device, channelId }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Authorization failed");
  return data;
};

const provider = new RevibaseProvider(onClientAuthorizationCallback);
```

### 5) Optional: device binding

```ts
provider.setChannelId("session-or-channel-id");
// ... run auth flows
await provider.closeChannel();
```

## How it works

1. **Frontend** opens Revibase popup and sends auth payload to your backend callback.
2. **Backend** calls `processClientAuthCallback` with `request`, `privateKey`, and `req.signal`.
3. **Frontend** receives `{ user }` or `{ txSig, user }`.

Your private key is server-only. The browser only handles payloads and results.

For custom instructions, use `executeTransaction` (see API reference).

---

**Quick checklist**
- Install `@revibase/lite`.
- Add `/.well-known/revibase.json` with `clientJwk`.
- Set `PRIVATE_KEY` on the server.
- Add a POST route using `processClientAuthCallback` and pass `req.signal`.
- Create `RevibaseProvider` and ensure callback `fetch` uses `signal`.
- Call `signIn(provider)` and/or `transferTokens` / `executeTransaction`.

**Security note:** Keep `PRIVATE_KEY` server-only and use HTTPS in production.

---

## API Reference

`@revibase/lite` exports browser client helpers, the browser `RevibaseProvider`, server helpers, and shared types.

### Client (browser)

| Function                                 | Description                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **`signIn(provider)`**                   | Opens the auth popup and returns `{ user: UserInfo }` after passkey auth.                                          |
| **`executeTransaction(provider, args)`** | Builds and executes a custom transaction. Action type is selected from wallet settings.                            |
| **`transferTokens(provider, args)`**     | Transfers SOL or SPL tokens. Set `mint` for SPL; omit for native SOL.                                              |

**Signatures**

```ts
function signIn(provider: RevibaseProvider): Promise<{ user: UserInfo }>;

function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    hasTxManager?: boolean;
    additionalSigners?: AdditionalSignersParam;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
): Promise<{ txSig?: string; user: UserInfo }>;

function transferTokens(
  provider: RevibaseProvider,
  args: {
    amount: number | bigint;
    destination: string;
    signer?: UserInfo;
    mint?: string;
    tokenProgram?: string;
  },
): Promise<{ txSig?: string; user: UserInfo }>;
```

### Provider (browser)

**`RevibaseProvider`** — Connects your app to the Revibase auth popup and your backend route.

- **Constructor:** `new RevibaseProvider(onClientAuthorizationCallback?, providerOrigin?)`
  - `onClientAuthorizationCallback` — Optional. Called with `(request, signal, device, channelId)`. POST `request`, `device`, and `channelId` to your backend and return JSON. Pass `signal` to `fetch` for cancellation.
  - `providerOrigin` — Optional. Default `https://auth.revibase.com`.
- **Methods**
  - `setChannelId(channelId: string): void` — Enables channel-based flows and includes device proof (`device`) + `channelId` in callback payloads.
  - `closeChannel(): Promise<void>` — Closes the active channel on the provider and clears local `channelId`.

### Server

| Function                                           | Description                                                                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`processClientAuthCallback(options)`**           | Validates the start request, calls Revibase start + getResult APIs, and returns `{ user }` (message) or `{ txSig, user }` (transaction). Pass `req.signal` to cancel fetches when the client disconnects. |
| **`createTransactionSigner(request, privateKey)`** | Signs an array of serialized transactions. Use when the provider requires additional signers.                                                                                                                    |

**Signatures**

```ts
function processClientAuthCallback(options: {
  request: StartMessageRequest | StartTransactionRequest;
  signal: AbortSignal; // pass req.signal from your POST route
  privateKey: string; // base64-encoded JWK
  device?: DeviceSignature; // { jwk, jws } from device-bound key when channelId is used
  channelId?: string;
  providerOrigin?: string;
  rpId?: string;
}): Promise<{ txSig?: string; user: UserInfo }>;

function createTransactionSigner(
  request: { transactions: string[] },
  privateKey: KeyPairSigner,
): Promise<{ signatures: string[] }>;
```

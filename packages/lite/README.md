# @revibase/lite

Add **Revibase** (passkey-based Solana wallet) to your app. Users sign in and sign transactions in a popup; your backend authorizes requests with a private key that never leaves the server.

## How it works

1. **Frontend** — User triggers sign-in or a transaction; the app opens a Revibase popup and sends the auth request to your backend.
2. **Backend** — Your POST route calls `processClientAuthCallback` with the request body and your **private key**, talks to the Revibase provider, and returns the result.
3. **Frontend** — The callback receives the result; the popup closes and your app gets `user` (and optionally `txSig`).

The private key is only used on the server. The client only sees the request/result payloads.

**Device binding (optional)** — When you pass a `channelId` to the provider, the SDK creates a **device-bound key** (Ed25519, non-exportable) and stores it in the browser’s IndexedDB. That key is used to sign the channel id; your backend receives `device: { jwk, jws }` and can bind the session to that device. The private key never leaves the device and cannot be exported.

## Prerequisites

Get a single **key pair** from [developers.revibase.com](https://developers.revibase.com). You will use:

- **Public key** → in `revibase.json` as `clientJwk`
- **Private key** → in env as `PRIVATE_KEY` (server-only)

## Setup

### 1. Install

```bash
pnpm add @revibase/lite
```

### 2. Well-known file

Serve `/.well-known/revibase.json` (e.g. from `public/.well-known/revibase.json`). Set `clientJwk` to the **public key** from your key pair.

```json
{
  "clientJwk": "<public-key-from-developers.revibase.com>",
  "title": "My App",
  "description": "Connect with passkeys"
}
```

### 3. Backend

Set `PRIVATE_KEY` to the **private key** from the same key pair. Add a POST route that forwards the client’s auth request to Revibase and returns the result. Pass **`req.signal`** into `processClientAuthCallback` so that when the user closes the popup or the client aborts, the server cancels in-flight requests.

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

### 4. Frontend provider

Create a `RevibaseProvider` whose callback POSTs the auth request to your route. Pass the callback’s **`signal`** to `fetch` so that when the popup is closed or the flow aborts, the client request (and thus the server’s `req.signal`) is cancelled.

```ts
import {
  type ClientAuthorizationCallback,
  RevibaseProvider,
} from "@revibase/lite";

const provider = new RevibaseProvider({
  onClientAuthorizationCallback: async (request, signal, device, channelId) => {
    const res = await fetch("/api/clientAuthorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request, device, channelId }),
      signal,
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        (data as { error?: string }).error ?? "Authorization failed",
      );
    return data;
  },
  channelId,
});
```

### 5. Sign in and send transactions

```ts
import { signIn, transferTokens } from "@revibase/lite";

const { user } = await signIn(provider);

const { txSig } = await transferTokens(provider, {
  amount: BigInt(100_000_000),
  destination: "RECIPIENT_ADDRESS",
  signer: user,
  // mint: "..."  // optional; omit for SOL
});
```

For custom instructions, use **`executeTransaction`** (see API reference).

---

**Checklist:** Install → add `/.well-known/revibase.json` with `clientJwk` → set `PRIVATE_KEY` → add POST route with `processClientAuthCallback` and `req.signal` (and `device`, `channelId` if using device binding) → create `RevibaseProvider` with callback that passes `signal` to `fetch` (optionally pass `channelId` for device-bound keys) → call `signIn(provider)` and/or `transferTokens` / `executeTransaction`.

**Security:** Store `PRIVATE_KEY` only on the server. Use HTTPS in production.

---

## API Reference

Public exports from `@revibase/lite`: client helpers (browser), `RevibaseProvider` (browser), server helpers, and types.

### Client (browser)

| Function                                 | Description                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **`signIn(provider)`**                   | Opens the auth popup and returns `{ user: UserInfo }` after WebAuthn sign-in.                                      |
| **`executeTransaction(provider, args)`** | Builds and executes a transaction (uses wallet settings to choose execute vs create_with_preauthorized_execution). |
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

**`RevibaseProvider`** — Connects your app to the Revibase auth popup and your backend.

- **Constructor:** `new RevibaseProvider(opts)`
  - `opts.onClientAuthorizationCallback` — **Required.** Called with `(request, signal, device, channelId)`. POST `request`, `device`, and `channelId` to your backend and return the JSON result. Pass `signal` to `fetch` for cancellation.
  - `opts.channelId` — Optional. When set, a device-bound key is created (or reused) and used to sign the channel; the callback receives `device: { jwk, jws }` for your backend to verify and bind the session.
  - `opts.providerOrigin` — Optional. Default `https://auth.revibase.com`.

### Server

| Function                                           | Description                                                                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`processClientAuthCallback(options)`**           | Validates the start request, calls the Revibase start + getResult APIs, returns `{ user }` (message) or `{ txSig, user }` (transaction). Pass `req.signal` so fetches are cancelled when the client disconnects. |
| **`createTransactionSigner(request, privateKey)`** | Signs an array of serialized transactions. Use when the provider requires additional signers.                                                                                                                    |

**Signatures**

```ts
function processClientAuthCallback(options: {
  request: StartMessageRequest | StartTransactionRequest;
  signal: AbortSignal;
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

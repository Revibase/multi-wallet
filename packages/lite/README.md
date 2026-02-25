# @revibase/lite

Add **Revibase** (a passkey-based Solana wallet) to your app. Users sign in and approve transactions in a popup, while your backend authorizes requests with a private key that stays server-side.

## Quick Start

```bash
pnpm add @revibase/lite
```

### 1) Get your keys

You can generate your public and private key at [https://developers.revibase.com](https://developers.revibase.com). The **clientJwk** in the config below is your public key.

### 2) Add well-known config

Create `/.well-known/revibase.json` (for example in `public/.well-known/revibase.json`):

```json
{
  "clientJwk": "<public-key-from-developers.revibase.com>",
  "title": "My App",
  "description": "Connect with passkeys"
}
```

### 3) Add backend route

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

### 4) Use in frontend

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

### 5) Optional: custom callback route

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

### 6) Optional: device binding

Channels use a WebSocket connection so you can react to status changes (e.g. when the recipient has connected).

```ts
import { ChannelStatus } from "@revibase/lite";

const { channelId, url } = await provider.createChannel();
// Optional: listen for channel status (AWAITING_RECIPIENT, RECIPIENT_CONNECTED, etc.)
const unsubscribe = provider.subscribeToChannelStatus((id, entry) => {
  if (entry.status === ChannelStatus.RECIPIENT_CONNECTED) {
    console.log("Recipient connected:", entry.recipient);
  }
});
// Open `url` in a new tab so the user can complete the channel handshake
// Pass channelId to use the channel (no popup) for subsequent flows:
const { user } = await signIn(provider, channelId);
const { txSig } = await transferTokens(
  provider,
  {
    amount: BigInt(100_000_000),
    destination: "RECIPIENT_ADDRESS",
    signer: user,
  },
  channelId,
);
// When done, close the channel:
await provider.closeChannel(channelId);
// Or close all channels: await provider.closeAllChannels();
unsubscribe(); // stop listening when done
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
- Call `signIn(provider)` and/or `transferTokens` / `executeTransaction`. For device binding, use `createChannel()`, optionally `subscribeToChannelStatus()` to react to status, pass `channelId` to sign-in/transfer/execute, then `closeChannel(channelId)` or `closeAllChannels()` when done.

**Security note:** Keep `PRIVATE_KEY` server-only and use HTTPS in production.

---

## API Reference

`@revibase/lite` exports browser client helpers, the browser `RevibaseProvider`, server helpers, and shared types.

### Client (browser)

| Function                                             | Description                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`signIn(provider, channelId?)`**                   | Opens the auth popup (or uses channel when `channelId` is set) and returns `{ user: UserInfo }` after passkey auth.                                               |
| **`executeTransaction(provider, args, channelId?)`** | Builds and executes a custom transaction. Action type is selected from wallet settings. Pass `channelId` for device-bound flow.                                   |
| **`transferTokens(provider, args, channelId?)`**     | Transfers SOL or SPL tokens. Set `mint` for SPL; omit for native SOL. `amount` must be &gt; 0; `destination` is required. Pass `channelId` for device-bound flow. |

**Signatures**

```ts
function signIn(
  provider: RevibaseProvider,
  channelId?: string,
): Promise<{ user: UserInfo }>;

function executeTransaction(
  provider: RevibaseProvider,
  args: {
    instructions: Instruction[];
    signer: UserInfo;
    hasTxManager?: boolean;
    additionalSigners?: AdditionalSignersParam;
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  },
  channelId?: string,
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
  channelId?: string,
): Promise<{ txSig?: string; user: UserInfo }>;
```

### Provider (browser)

**`RevibaseProvider`** — Connects your app to the Revibase auth popup and your backend route. Device-bound flows use a WebSocket connection for real-time channel status.

- **Constructor:** `new RevibaseProvider(onClientAuthorizationCallback?, providerOrigin?)`
  - `onClientAuthorizationCallback` — Optional. Called with `(request, signal, device, channelId)`. POST `request`, `device`, and `channelId` to your backend and return JSON. Pass `signal` to `fetch` for cancellation.
  - `providerOrigin` — Optional. Default `https://auth.revibase.com`.
- **Channel status** — `ChannelStatus` enum: `AUTHENTICATING`, `AWAITING_RECIPIENT`, `RECIPIENT_CONNECTED`, `CHANNEL_CLOSED`, `ERROR`. `ChannelStatusEntry` has `status`, optional `recipient`, and optional `error`.
- **Methods**
  - `createChannel(): Promise<{ channelId: string; url: string }>` — Creates a channel and a WebSocket connection for that channel. Open the returned `url` in a new tab so the user can complete the handshake. Pass `channelId` to `signIn`, `transferTokens`, or `executeTransaction` to use the channel (no popup). Callback payloads will include device proof (`device`) and `channelId`.
  - `subscribeToChannelStatus(listener: ChannelStatusListener): () => void` — Subscribe to channel status updates. Returns an unsubscribe function. Listener is called with `(channelId, entry: ChannelStatusEntry)`.
  - `cancelChannelRequest(channelId: string): Promise<void>` — Cancels any pending request on the given channel (e.g. waiting for recipient). No-op if there is no pending request.
  - `closeChannel(channelId: string): Promise<void>` — Closes the given channel (sends close over WebSocket and cleans up).
  - `closeAllChannels(): Promise<void>` — Closes all active channels.

### Server

| Function                                 | Description                                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`processClientAuthCallback(options)`** | Validates the start request, calls Revibase start + getResult APIs, and returns `{ user }` (message) or `{ txSig, user }` (transaction). Pass `req.signal` to cancel fetches when the client disconnects. |

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
```

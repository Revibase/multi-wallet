# @revibase/lite

Passkey-based Solana wallet: sign in and approve transactions in a popup; backend authorizes with a server-side private key.

## Quick Start

```bash
pnpm add @revibase/lite
```

1. **Keys & config** — Get public/private key at [developers.revibase.com](https://developers.revibase.com). Add `/.well-known/revibase.json` with `clientJwk` (your public key), `title`, `description`.
2. **Backend** — Set `PRIVATE_KEY`. POST route: parse `{ request, device, channelId }` from body, call `processClientAuthCallback({ request, privateKey: process.env.PRIVATE_KEY!, signal: req.signal, device, channelId })`, return JSON.
3. **Frontend** — Default callback POSTs to `/api/clientAuthorization`. If your path differs, pass a custom callback as 2nd arg to `RevibaseProvider`.

```ts
import {
  type DeviceSignature,
  processClientAuthCallback,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/lite";

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
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 });
  }
}
```

```ts
import { RevibaseProvider, signIn, transferTokens } from "@revibase/lite";

const provider = new RevibaseProvider();
const { user } = await signIn(provider);
const { txSig } = await transferTokens(provider, { amount: BigInt(100_000_000), destination: "ADDRESS", signer: user });
```

**Custom callback:** `new RevibaseProvider(undefined, async (request, signal, device, channelId) => { const res = await fetch("/api/your-route", { method: "POST", body: JSON.stringify({ request, device, channelId }), signal }); const data = await res.json(); if (!res.ok) throw new Error(data?.error ?? "Authorization failed"); return data; })`

**Device binding (no popup):** `const { channelId, url } = await provider.createChannel();` — open `url` in a tab. Then `signIn(provider, { channelId })`, `transferTokens(provider, args, { channelId })`, etc. `subscribeToChannelStatus(listener)`, `closeChannel(channelId)` / `closeAllChannels()`.

**Security:** Keep `PRIVATE_KEY` server-only; use HTTPS in production.

---

## API

**Client:** `signIn(provider, options?)` → `{ user }`. `transferTokens(provider, args, options?)` → `{ txSig?, user }`. `executeTransaction(provider, args, options?)` → `{ txSig?, user }`. Options: `{ signal?: AbortSignal, channelId?: string }` (type: `AuthorizationFlowOptions`).

**Provider:** `new RevibaseProvider(providerOrigin?, onClientAuthorizationCallback?, logger?)`. Methods: `createChannel()` → `{ channelId, url }`, `subscribeToChannelStatus(listener)` → unsubscribe fn, `cancelChannelRequest(channelId)`, `closeChannel(channelId)`, `closeAllChannels()`. Channel status: `ChannelStatus` enum, `ChannelStatusEntry`.

**Server:** `processClientAuthCallback({ request, signal, privateKey, device?, channelId?, providerOrigin?, rpId? })` → `{ user }` or `{ txSig?, user }`. Pass `req.signal` so fetches cancel on client disconnect.

**Errors:** `RevibaseError` base; `RevibasePopupBlockedError`, `RevibasePopupClosedError`, `RevibaseTimeoutError`, `RevibaseFlowInProgressError`, `RevibaseAbortedError`, `RevibaseAuthError`, `RevibaseEnvironmentError`, `RevibasePopupNotOpenError`. All have `.code` (e.g. `"POPUP_BLOCKED"`, `"TIMEOUT"`).

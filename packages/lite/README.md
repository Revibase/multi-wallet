# @revibase/lite

Passkey Solana wallet: sign in and approve transactions in a popup. Backend authorizes with a server-side private key.

```bash
pnpm add @revibase/lite
```

**API** — Frontend: `RevibaseProvider`, `signIn`, `transferTokens`, `executeTransaction`. Backend: `processClientAuthCallback`. Types: `UserInfo`, `ChannelStatus`, `StartChannelRequest`, `AuthorizationFlowOptions`, `RevibaseProviderOptions`. Errors: `RevibaseError` + subclasses (`.code`). [AGENTS.md](./AGENTS.md) for automation.

---

## Get started

Three steps: keys, backend route, provider.

**Timeouts:** Auth flows expire after **3 minutes** by default (the `validTill` on requests and the popup flow timeout). Use `AuthorizationFlowOptions.signal` to abort early.

### 1. Keys

Get keys at [developers.revibase.com](https://developers.revibase.com). Add `/.well-known/revibase.json` with `clientJwk`, `title`, `description`.

### 2. Backend

Expose **POST** at **`/api/clientAuthorization`** (default). Keep `PRIVATE_KEY` server-only; HTTPS in production.

Example handler:

```ts
import {
  processClientAuthCallback,
  type DeviceSignature,
  type StartChannelRequest,
  type StartMessageRequest,
  type StartTransactionRequest,
} from "@revibase/lite";

export async function POST(req: Request) {
  try {
    const { request, device, channelId } = (await req.json()) as {
      request:
        | StartMessageRequest
        | StartTransactionRequest
        | StartChannelRequest;
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
    // Message/transaction: { user, txSig? }. Channel registration (createChannel): { ok: true }.
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
```

### 3. Frontend

Create a provider. For `executeTransaction`, pass `rpcEndpoint` in options:

```ts
import {
  RevibaseProvider,
  signIn,
  transferTokens,
  executeTransaction,
} from "@revibase/lite";

const provider = new RevibaseProvider();
const { user } = await signIn(provider);
const { txSig } = await transferTokens(provider, {
  amount: BigInt(100_000_000),
  destination: "ADDRESS",
  signer: user, // optional for transfers
});
```

**Custom instructions** — Build instructions with `gill` (Solana instruction builder) or similar, then pass to `executeTransaction`.

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

Default: auth in popup. For auth on another device, use a channel (below).

---

## Auth on another device (channel)

Channel: auth on another device; requests go there. `createChannel()` first POSTs to your `/api/clientAuthorization` with a `StartChannelRequest` so the server can register the channel with Revibase; then it returns `{ channelId, url }`. Open `url` on that device:

```ts
const { channelId, url } = await provider.createChannel();
```

```ts
const { user } = await signIn(provider, { channelId });
const { txSig } = await transferTokens(
  provider,
  { amount, destination, signer: user },
  { channelId },
);
// Or: executeTransaction(provider, { instructions, signer: user }, { channelId })
```

Use `subscribeToChannelStatus` to check channel status.

```ts
import { ChannelStatus } from "@revibase/lite";

provider.subscribeToChannelStatus((id, entry) => {
  switch (entry.status) {
    case ChannelStatus.AUTHENTICATING:
      break; // show "Connecting…"
    case ChannelStatus.AWAITING_RECIPIENT:
      break; // show "Waiting for other device"
    case ChannelStatus.RECIPIENT_CONNECTED:
      break; // show "Connected" (entry.recipient)
    case ChannelStatus.RECIPIENT_DISCONNECTED:
      break; // show "Other device left"
    case ChannelStatus.AUTO_RECONNECTING:
      break; // show "Reconnecting…" (entry.reconnectAttempt)
    case ChannelStatus.CONNECTION_LOST:
      break; // show "Connection lost. [Retry]" → provider.reconnectChannel(id)
    case ChannelStatus.CHANNEL_CLOSED:
      break; // show "Channel closed"
    case ChannelStatus.ERROR:
      break; // show entry.error
  }
});
```

### Reconnect

If the channel connection is lost, call `reconnectChannel(channelId)`:

```ts
provider.reconnectChannel(channelId);
```

### Cleanup

```ts
provider.closeChannel(channelId);
// or
provider.closeAllChannels();
```

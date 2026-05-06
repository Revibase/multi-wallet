# @revibase/lite

Passkey Solana wallet: sign in and approve transactions in a popup. Backend authorizes with a server-side private key.

```bash
pnpm add @revibase/lite
```

**API** — Frontend: `RevibaseProvider`, `signIn`, `transferTokens`, `executeTransaction`. Backend: `processClientAuthCallback`. Types: `UserInfo`, `StartMessageRequest`, `StartTransactionRequest`, `CompleteMessageRequest`, `CompleteTransactionRequest`, `SignInAuthorizationFlowOptions`, `TransactionAuthorizationFlowOptions`, `RevibaseProviderOptions`. Errors: `RevibaseError` + subclasses (`.code`). [AGENTS.md](./AGENTS.md) for automation.

---

## Get started

Three steps: keys, backend route, provider.

**Timeouts:** Auth flows expire after **3 minutes** by default (the `validTill` on requests and the popup flow timeout). Use the flow options `signal` to abort early.

### 1. Keys

Get keys at [developers.revibase.com](https://developers.revibase.com). Add `/.well-known/revibase.json` with `clientJwk`, `title`, `description`.

### 2. Backend

Expose **POST** at **`/api/clientAuthorization`** (default). Keep `PRIVATE_KEY` server-only; HTTPS in production.

Example handler:

```ts
import {
  processClientAuthCallback,
  processEstimateJitoTipsCallback,
  processSendJitoBundleCallback,
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
    // Start: { ok: true, signature, validTill }. Complete-message: { ok: true }. Complete-transaction: { ok: true, signature }.
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
```

Optional (only needed if you plan to use executeTransactions):

- `POST /api/sendJitoBundle` — expects JSON body `string[]` (serialized txs). Returns Jito bundle ID (string):

```ts
export async function POST(req: Request) {
  const serializedTransactions = (await req.json()) as string[];
  const bundleId = await processSendJitoBundleCallback(
    serializedTransactions,
    process.env.JITO_UUID, // optional
  );
  return Response.json(bundleId);
}
```

- `GET /api/estimateJitoTips` — returns estimated tip amount (lamports, number):

```ts
export async function GET() {
  const tipsLamports = await processEstimateJitoTipsCallback();
  return Response.json(tipsLamports);
}
```

### 3. Frontend

Create a provider. `rpcEndpoint` is required.

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

Default: auth in popup.

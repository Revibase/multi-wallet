# Integrating Revibase as a Wallet with @revibase/lite

Use **@revibase/lite** so users can sign in with Revibase and use it as a wallet. The flow: frontend calls your API with an auth request → your server calls `processClientAuthCallback` with a **private key** → returns result to client. The key never leaves your server.

**Key pair:** At [developers.revibase.com](https://developers.revibase.com) you get one **key pair**. Put the **public key** in `revibase.json` as `clientJwk` and the **private key** in `PRIVATE_KEY`.

---

## 1. Install

```bash
pnpm add @revibase/lite
```

## 2. Well-known file

Add `public/.well-known/revibase.json` (served at `/.well-known/revibase.json`). Use the **public key** from your key pair as `clientJwk` (from [developers.revibase.com](https://developers.revibase.com)).

```json
{
  "clientJwk": "<from-developers.revibase.com>",
  "title": "My App",
  "description": "Connect with passkeys"
}
```

## 3. Backend

Set env **`PRIVATE_KEY`** to the **private key** from the same key pair (from [developers.revibase.com](https://developers.revibase.com)). Add a POST route (e.g. `app/api/clientAuthorization/route.ts`):

```ts
import { processClientAuthCallback } from "@revibase/lite";

export async function POST(req: Request) {
  try {
    const { request } = (await req.json()) as { request: unknown };
    const result = await processClientAuthCallback({
      request,
      privateKey: process.env.PRIVATE_KEY!,
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

## 4. Frontend

Create a provider that POSTs the auth request to your route:

```ts
import {
  type ClientAuthorizationCallback,
  RevibaseProvider,
} from "@revibase/lite";

const provider = new RevibaseProvider({
  onClientAuthorizationCallback: async (request) => {
    const res = await fetch("/api/clientAuthorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        (data as { error?: string }).error ?? "Authorization failed",
      );
    return data;
  },
});
```

## 5. Sign in & transfer

```ts
import { signIn, transferTokens } from "@revibase/lite";

const { user } = await signIn(provider);

const { txSig } = await transferTokens(provider, {
  amount: BigInt(100_000_000),
  destination: "RECIPIENT_ADDRESS",
  signer: user,
  // mint: "..." // optional; omit for SOL
});
```

---

**Checklist:** Install → add `public/.well-known/revibase.json` → set `PRIVATE_KEY` → add POST route with `processClientAuthCallback` → create `RevibaseProvider` with callback → `signIn(provider)` then `transferTokens(provider, { … })`.

**Security:** Keep `PRIVATE_KEY` server-only. Use HTTPS in production.

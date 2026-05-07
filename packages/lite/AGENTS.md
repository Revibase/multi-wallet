# @revibase/lite — Agent reference

Reference for AI agents. Full docs: [README.md](./README.md).

## Purpose

Passkey Solana wallet: sign-in and transactions in popup or on another device (channel). Backend authorizes via `/api/clientAuthorization`.

## Build & Test

- Install: `pnpm install` (from repo root)
- Build: `pnpm build` (in `packages/lite`)
- Package: `@revibase/lite` — consumers: `pnpm add @revibase/lite`

## Entry points (import from `@revibase/lite`)

| Category              | Exports                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider**          | `RevibaseProvider`, `RevibaseProviderOptions`                                                                                                                                                                                                            |
| **Client (frontend)** | `signIn`, `transferTokens`, `executeTransaction`                                                                                                                                                                                                         |
| **Server (backend)**  | `processClientAuthCallback`, `processSendJitoBundleCallback`, `processEstimateJitoTipsCallback`                                                                                                                                                          |
| **Types**             | `UserInfo`, `StartMessageRequest`, `StartTransactionRequest`, `CompleteMessageRequest`, `CompleteTransactionRequest`, `ClientAuthorizationCallback`, `SignInAuthorizationFlowOptions`, `TransactionAuthorizationFlowOptions` |
| **Errors**            | `RevibaseError`, `RevibasePopupBlockedError`, `RevibasePopupClosedError`, `RevibaseTimeoutError`, `RevibaseFlowInProgressError`, `RevibaseAbortedError`, `RevibaseAuthError`, `RevibaseEnvironmentError`, `RevibasePopupNotOpenError` (all have `.code`) |

## Main flows

1. **Iframe (default)** — `new RevibaseProvider({ rpcEndpoint })`, then `signIn(provider)`, `transferTokens(provider, args)`, or `executeTransaction(provider, args)`. Auth in same-device iframe overlay. The SDK cleans up the iframe when the flow finishes or is dismissed.
2. **Popup (opt-in)** — pass `new RevibaseProvider({ rpcEndpoint, ui: { mode: "popup" } })` to open a popup window instead of an iframe.

## Provider constructor

```ts
new RevibaseProvider(options: RevibaseProviderOptions)
```

- `RevibaseProviderOptions`: `rpcEndpoint` required. Optional: `providerOrigin?`, `rpId?`, `ui?: { mode?: "popup" | "iframe"; render?: (url) => ({ targetWindow, close, isClosed? }) }`, `onClientAuthorizationCallback?`, `logger?`.
- `ClientAuthorizationCallback`: overloads for `StartMessageRequest` / `StartTransactionRequest` and their completion payloads. Start returns `{ ok: true; signature: string; validTill: number }`. Complete-message returns `{ ok: true }`. Complete-transaction returns `{ ok: true; signature: string }`.

## Client function signatures

- `signIn(provider, options?)` → `Promise<{ user: UserInfo }>`
- `transferTokens(provider, { amount, destination, signer?, mint?, tokenProgram? }, options?)` → `Promise<{ txSig?, user }>`
- `executeTransaction(provider, { instructions, signer, settingsIndexWithAddress?, additionalSigners?, addressesByLookupTableAddress? }, options?)` → `Promise<{ txSig?, user }>`

`options`: `SignInAuthorizationFlowOptions` / `TransactionAuthorizationFlowOptions` — both support `{ signal? }`.

## Server

- Backend POST at `/api/clientAuthorization`. Body: the `request` object itself (start/complete payload). Call `processClientAuthCallback({ request, publicKey, allowedClientOrigins, privateKey, require2FAChecks? })` and return the result as JSON.
- `request` is `StartMessageRequest | StartTransactionRequest | CompleteMessageRequest | CompleteTransactionRequest`. Start returns `{ ok: true; signature; validTill }`. Complete-message returns `{ ok: true }`. Complete-transaction returns `{ ok: true; signature }`.
- Optional endpoints used by `executeTransaction` when sending Jito bundles:
  - `POST /api/sendJitoBundle` → call `processSendJitoBundleCallback(serializedTransactions, jitoUUID?)` and return the bundle ID as JSON.
  - `GET /api/estimateJitoTips` → call `processEstimateJitoTipsCallback()` and return the tip amount (lamports) as JSON.

## File map

| Path                   | Contents                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| `src/index.ts`         | Re-exports from client, provider, server, utils                          |
| `src/client/`          | `signIn`, `transferTokens`, `executeTransaction` |
| `src/provider/main.ts` | `RevibaseProvider`, options, popup transport                             |
| `src/server/`          | `processClientAuthCallback`, `startRequest`, `startChannel`, `validateMessage` |
| `src/utils/`           | Types, errors, consts                                                    |

## Agent rules

- Do NOT change public API signatures without updating this file.
- When adding exports, add them to the Entry points table.
- For `executeTransaction`, `rpcEndpoint` in provider options is required.

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
| **Provider**          | `RevibaseProvider`, `RevibaseProviderOptions`, `ChannelStatus`, `ChannelStatusEntry`, `ChannelStatusListener`                                                                                                                                            |
| **Client (frontend)** | `signIn`, `transferTokens`, `executeTransaction`                                                                                                                                                                                                         |
| **Server (backend)**  | `processClientAuthCallback`                                                                                                                                                                                                                              |
| **Types**             | `UserInfo`, `StartMessageRequest`, `StartTransactionRequest`, `StartChannelRequest`, `StartChannelRequestSchema`, `CompleteMessageRequest`, `CompleteTransactionRequest`, `DeviceSignature`, `ClientAuthorizationCallback`, `AuthorizationFlowOptions`         |
| **Errors**            | `RevibaseError`, `RevibasePopupBlockedError`, `RevibasePopupClosedError`, `RevibaseTimeoutError`, `RevibaseFlowInProgressError`, `RevibaseAbortedError`, `RevibaseAuthError`, `RevibaseEnvironmentError`, `RevibasePopupNotOpenError` (all have `.code`) |

## Main flows

1. **Popup (default)** — `new RevibaseProvider()`, then `signIn(provider)`, `transferTokens(provider, args)`, or `executeTransaction(provider, args)`. Auth in same-device popup. The SDK does not close the popup after the flow; the provider UI manages window lifecycle.
2. **Channel (auth on another device)** — `provider.createChannel()` first calls `onClientAuthorizationCallback` with a `StartChannelRequest` (register channel with backend / Revibase), then returns `{ channelId, url }`. Open `url` on other device. Then `signIn(provider, { channelId })`, etc. `subscribeToChannelStatus` for status; `reconnectChannel(channelId)` for manual retry.

## Provider constructor

```ts
new RevibaseProvider(options?: RevibaseProviderOptions)
```

- `RevibaseProviderOptions`: all optional — `providerOrigin?`, `onClientAuthorizationCallback?`, `rpcEndpoint?` (needed for `executeTransaction`), `logger?`.
- `ClientAuthorizationCallback`: overloads for `StartMessageRequest`, `StartTransactionRequest`, and `StartChannelRequest`; `signal` is optional on all. Message/transaction return `{ user }` or `{ txSig?, user }`; channel (`data.type === "channel"`) returns `{ ok: true }`.

## Client function signatures

- `signIn(provider, options?)` → `Promise<{ user: UserInfo }>`
- `transferTokens(provider, { amount, destination, signer?, mint?, tokenProgram? }, options?)` → `Promise<{ txSig?, user }>`
- `executeTransaction(provider, { instructions, signer, settingsIndexWithAddress?, additionalSigners?, addressesByLookupTableAddress? }, options?)` → `Promise<{ txSig?, user }>`

`options` for all: `AuthorizationFlowOptions` = `{ signal?, channelId? }`.

## Server

- Backend POST at `/api/clientAuthorization`. Body: `{ request, device?, channelId? }`. Call `processClientAuthCallback({ request, privateKey, signal?, device, channelId?, providerOrigin?, rpId? })` and return the result as JSON.
- `request` is `StartMessageRequest | StartTransactionRequest | StartChannelRequest`. Message/transaction responses include `user` (and optionally `txSig`); channel registration returns `{ ok: true }` (no `user`). `processClientAuthCallback` handles channel by signing and calling Revibase `startChannel` (see `src/server/startChannel.ts`).

## Channel status (for channel flow)

`ChannelStatus` enum: `AUTHENTICATING`, `AWAITING_RECIPIENT`, `RECIPIENT_CONNECTED`, `RECIPIENT_DISCONNECTED`, `AUTO_RECONNECTING`, `CONNECTION_LOST`, `CHANNEL_CLOSED`, `ERROR`.  
`ChannelStatusEntry`: `status`, `recipient?`, `error?`, `reconnectAttempt?` (when `AUTO_RECONNECTING`).  
Provider methods: `createChannel()`, `subscribeToChannelStatus(listener)`, `cancelChannelRequest(channelId)`, `reconnectChannel(channelId)`, `closeChannel(channelId)`, `closeAllChannels()`.

## File map

| Path                   | Contents                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| `src/index.ts`         | Re-exports from client, provider, server, utils                          |
| `src/client/`          | `signIn`, `transferTokens`, `executeTransaction`, `runAuthorizationFlow` |
| `src/provider/main.ts` | `RevibaseProvider`, `ChannelStatus`, options, channel methods            |
| `src/server/`          | `processClientAuthCallback`, `startRequest`, `startChannel`, `validateMessage` |
| `src/utils/`           | Types, errors, consts                                                    |

## Agent rules

- Do NOT change public API signatures without updating this file.
- When adding exports, add them to the Entry points table.
- For `executeTransaction`, `rpcEndpoint` in provider options is required.

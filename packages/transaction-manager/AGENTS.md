# @revibase/transaction-manager — Agent reference

Reference for AI agents. Full docs: `README.md` in this folder.

## Purpose

Server-side verifier and signer for Revibase multi-wallet transactions.  
Given a serialized Solana transaction (produced by `@revibase/core` / `@revibase/lite`), this package:

- Decodes and inspects the instructions and signers.
- Applies whitelist / policy logic you define.
- Returns the transaction message bytes to sign plus structured verification metadata.

Agents should use this package to implement a single, auditable signing service in the backend.

## Build & Package

- Install: `pnpm install` (from repo root)
- Build: `pnpm build` (in `packages/transaction-manager`)
- Package: `@revibase/transaction-manager` — consumers: `pnpm add @revibase/transaction-manager`

## Entry points (import from `@revibase/transaction-manager`)

Public exports from `src/index.ts`:

| Category     | Exports                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **Function** | `verifyTransaction`, `verifyMessage`                                                                        |
| **Types**    | `TransactionManagerConfig`, `VerifyTransactionResult`, `ExpectedTransactionSigner`, `WellKnownClientCacheEntry` |

### `verifyTransaction`

```ts
import { verifyTransaction, type TransactionManagerConfig } from "@revibase/transaction-manager";

const config: TransactionManagerConfig = {
  publicKey: "<base58 transaction manager pubkey>",
  url: "https://your-transaction-manager.com/sign",
};

const result = await verifyTransaction(config, {
  transaction,
  transactionMessageBytes?, // optional, base64 string from client
  authResponses?, // optional TransactionAuthDetails[] from @revibase/core
});
```

Return type: `VerifyTransactionResult`:

- `messageBytes`: `Uint8Array` — raw transaction message bytes to sign (Ed25519).
- `verificationResults`: `Array<{ instructions: Instruction[]; signers: ExpectedTransactionSigner[] }>` — one batch per multi-wallet instruction group.

### `verifyMessage`

```ts
import { verifyMessage } from "@revibase/transaction-manager";
import type { CompleteMessageRequest } from "@revibase/core";

declare const transactionManagerPublicKey: string;
declare const payload: CompleteMessageRequest;

const { messageBytes, verificationResults } = await verifyMessage(
  transactionManagerPublicKey,
  payload,
);
```

Use this to verify sign-in / message auth payloads (client signature + device signature + user signature), optionally providing `getClientDetails(origin)` for custom well-known client lookup.

### `TransactionManagerConfig`

- `publicKey`: Base58-encoded public key of the transaction manager.
- `url`: Public HTTPS URL of the transaction manager service.

### `ExpectedTransactionSigner`

Union of:

- Passkey / secp256r1 signer:
  - `signer`: `Secp256r1Key`
  - `walletAddress`: `Address`
  - `client`: `{ origin: string } & WellKnownClientEntry`
  - `device`: string identifier
  - `startRequest`: `initial transaction request`
  - `estimatedValidTill`: number (ms since epoch)
- Plain address signer:
  - `signer`: `Address`
  - `walletAddress`: `Address`

Use this type in policies to understand _who_ is authorizing a transaction (`origin`, device, wallet address).

### `WellKnownClientCacheEntry`

- `clientJwk`: Base64-encoded JWK string for the client.
- `cachedAt`: Unix timestamp (ms) when this entry was cached.

## Typical backend flow (for agents)

To integrate `@revibase/transaction-manager` into a backend:

1. **Generate a transaction manager keypair**
   - Use Ed25519 via WebCrypto.
   - Store the public key (base58) and the secret key (base58) in secrets.

2. **Configure environment**
   - `TX_MANAGER_SECRET_KEY`: Manager secret key (base58 string).
   - `TX_MANAGER_PUBLIC_KEY`: Manager public key (base58).
   - `TX_MANAGER_URL`: Public HTTPS URL of the signing endpoint.
   - `RPC_URL` (optional): Solana RPC URL for account / LUT lookups.

3. **Create an HTTPS signing endpoint**
   - Endpoint example: `POST /sign` at `https://your-transaction-manager.com/sign`.
   - Request body (from client bundle, e.g. `@revibase/core` / `@revibase/lite`):
     - `{ publicKey: string; payload: { transaction: string; transactionMessageBytes?: string; authResponses?: unknown[] }[] }`
   - For each `payload` item:
     - Call `verifyTransaction(transactionManagerConfig, payloadItem)`.
     - Run a policy function against the `VerifyTransactionResult`.
     - If allowed, sign `result.messageBytes` with the manager's Ed25519 key and return base58 signatures.

4. **Implement policy (`enforcePolicies`)**
   - Iterate over `results.verificationResults`.
   - For each batch:
     - Validate `signers` (e.g. origin whitelists, required auth provider, allowed devices).
     - Inspect `instructions` (e.g. only allow native SOL transfers up to a limit).
   - Throw on any violation so the endpoint does **not** sign.

## File map

| Path                                  | Contents                                                            |
| ------------------------------------- | ------------------------------------------------------------------- |
| `src/index.ts`                        | Public exports (`verifyTransaction`, `verifyMessage`, types)        |
| `src/verify-transaction.ts`           | Core decoding, whitelist checks, and routing into processors        |
| `src/verify-message.ts`               | Verify sign-in/message auth payloads                                |
| `src/types.ts`                        | `TransactionManagerConfig`, `VerifyTransactionResult`, signer types |
| `src/processors/*.ts`                 | Per-instruction handlers (change config, transfer intents, buffers) |
| `src/utils/transaction-parsing.ts`    | Transaction message parsing and LUT resolution                      |
| `src/utils/signature-verification.ts` | WebAuthn / secp256r1 verification helpers                           |
| `src/utils/consts.ts`                 | Whitelisted programs, lookup table addresses                        |
| `src/utils/fetch-well-known.ts`       | Fetching and caching well-known client metadata                     |

## Agent rules

- Do NOT change public exports (`verifyTransaction`, types) without updating:
  - This `AGENTS.md`
  - `README.md` in the same folder
- Keep example flows consistent:
  - Signing endpoint must always:
    1. Call `verifyTransaction`
    2. Run policy checks on `VerifyTransactionResult`
    3. Only then sign `messageBytes`
- Never hardcode private keys in the repository. Use environment / secret management only.

# Revibase multi-wallet

Monorepo for the **Revibase** Solana multi-wallet SDK: passkey sign-in, transfer intents, custom transactions, and server-side transaction verification and signing.

## Overview

This repository contains:

- **TypeScript packages** (`packages/`) — SDK for building apps that use Revibase multi-wallets
- **Solana program** (`programs/multi_wallet/`) — on-chain multi-wallet logic (Anchor/Rust)
- **Tests** (`tests/`) — integration tests for the SDK

Use the packages together to add passkey-based wallets, configurable policies, and a backend transaction manager to your Solana app.

## Packages

| Package | Description |
|--------|-------------|
| **[@revibase/lite](packages/lite)** | Passkey wallet: sign-in and approve transactions in a popup (or on another device). Backend authorizes via `/api/clientAuthorization`. |
| **[@revibase/core](packages/core)** | Core types and helpers: create users/wallets, transfer intents (SOL/SPL), and custom vault-paid transactions (sync or Jito bundles). |
| **[@revibase/transaction-manager](packages/transaction-manager)** | Server-side verifier and signer: decode and verify transaction intents, apply your policy, then sign with an Ed25519 key. |

- **Lite** and **core** are used in the frontend (and core in backend too) to build and submit transactions.
- **Transaction-manager** runs in your backend: it verifies each request and signs only when your policy allows.

Each package has its own README; see the links above. For automation and agents, see [AGENTS.md](./AGENTS.md).

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (v10+)

### Install and build

```bash
# Install dependencies
pnpm install

# Build all packages (from repo root, run build in each package)
cd packages/core && pnpm build && cd ../..
cd packages/transaction-manager && pnpm build && cd ../..
cd packages/lite && pnpm build && cd ../..
```

### Run tests

```bash
# TypeScript integration tests
pnpm test

# Rust unit tests for the multi_wallet program
anchor build
cargo test -p multi_wallet --lib
```

### Use in your app

Install only what you need:

```bash
# Passkey sign-in + transfers + custom txs (frontend + backend auth)
pnpm add @revibase/lite

# Transfer intents, custom txs, Jito bundles (no passkey UI)
pnpm add @revibase/core

# Server-side transaction verification and signing
pnpm add @revibase/transaction-manager
```

`@revibase/lite` depends on `@revibase/core`. The transaction manager is optional and used when you want a dedicated backend signer with policy checks.

## Repository structure

```
multi-wallet/
├── packages/
│   ├── lite/                 # @revibase/lite — passkey provider + client + server auth
│   ├── core/                 # @revibase/core — intents, transactions, Jito
│   └── transaction-manager/  # @revibase/transaction-manager — verify + policy + sign
├── programs/
│   └── multi_wallet/          # Solana program (Anchor)
├── tests/                     # Integration tests
├── AGENTS.md                  # Agent/automation reference
├── package.json
└── pnpm-workspace.yaml
```

## Scripts (root)

| Script | Description |
|--------|-------------|
| `pnpm test` | Run TypeScript integration tests |
| `pnpm lint` | Check formatting (Prettier) |
| `pnpm lint:fix` | Fix formatting |

Per-package scripts (e.g. `build`, `generate`) are in each `packages/<name>/package.json`.

## License

MIT. See [LICENSE](./LICENSE).

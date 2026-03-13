# Revibase multi-wallet — Agent reference

Monorepo for the Revibase Solana multi-wallet SDK. Human-facing overview: [README.md](./README.md).

## Packages

| Package | Purpose | Docs |
| ------- | ------- | ---- |
| `@revibase/lite` | Passkey wallet: sign-in + txs in popup or other device; backend auth via `/api/clientAuthorization` | [packages/lite/AGENTS.md](packages/lite/AGENTS.md) |
| `@revibase/core` | Transfer intents, custom transactions (sync/Jito), create users/wallets | [packages/core/README.md](packages/core/README.md) |
| `@revibase/transaction-manager` | Server-side tx verification and policy-based signing | [packages/transaction-manager/README.md](packages/transaction-manager/README.md), [packages/transaction-manager/AGENTS.md](packages/transaction-manager/AGENTS.md) |

- **Lite** and **core**: frontend + backend; build and submit multi-wallet transactions.
- **Transaction-manager**: backend only; verify requests and sign when policy allows.

## Build & Test

- **Install:** `pnpm install` (from repo root)
- **Build:** run `pnpm build` inside each package, e.g. `packages/core`, `packages/transaction-manager`, `packages/lite`
- **Tests:** `pnpm test` (root) — TypeScript integration tests
- **Rust (program):** `anchor build` then `cargo test -p multi_wallet --lib`

## Repository layout

- `packages/lite` — passkey provider, client flows, server auth
- `packages/core` — intents, transactions, Jito, generated IDL types
- `packages/transaction-manager` — verify + policy + sign
- `programs/multi_wallet` — Solana program (Anchor/Rust)
- `tests/` — integration tests

## Agent rules

- **Docs:** Each package has its own README. `@revibase/lite` and `@revibase/transaction-manager` also have an AGENTS.md; prefer those for automation.
- **Exports:** Do NOT change public exports without updating the package README (and AGENTS.md if present).
- **Editing:** When editing a package, read its README/AGENTS.md first.
- **Secrets:** Never commit or hardcode private keys; use env/secret management only.

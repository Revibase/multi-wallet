# Revibase multi-wallet SDK

Monorepo for Revibase Solana multi-wallet packages. Agent-facing reference.

## Packages

| Package                    | Purpose                                                | Docs                         |
| -------------------------- | ------------------------------------------------------ | ---------------------------- |
| `@revibase/lite`           | Passkey wallet: sign-in + txs in popup or other device | [packages/lite/AGENTS.md](packages/lite/AGENTS.md) |
| `@revibase/core`           | Transfer intents, custom transactions (sync/Jito)      | [packages/core/README.md](packages/core/README.md) |
| `@revibase/transaction-manager` | Server-side tx verification and signing             | [packages/transaction-manager/README.md](packages/transaction-manager/README.md) |
| `@revibase/wallet`         | Wallet adapter integration                             | [packages/wallet-adapter/README.md](packages/wallet-adapter/README.md) |

## Build & Test

- Install: `pnpm install`
- Build per package: `pnpm build` (in `packages/<name>`)
- Tests: `pnpm test` (root)

## Agent rules

- Each package has its own README; `@revibase/lite` also has AGENTS.md for automation.
- Do NOT change public exports without updating the package docs.
- When editing a package, read its docs first.

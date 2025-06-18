// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  external: [
    "@solana/kit",
    "@solana/transaction-confirmation",
    "@solana-program/compute-budget",
    "@solana/wallet-standard-features",
    "@wallet-standard/base",
    "@wallet-standard/core",
    "@wallet-standard/features",
  ],
});

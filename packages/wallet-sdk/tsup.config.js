// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  external: [
    "@solana/kit",
    "@solana-program/system",
    "@solana-program/token",
    "@solana-program/token-2022",
  ],
});

// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: true,
  minify: true,
  external: ["@solana/web3.js", "@lightprotocol/stateless.js"],
});

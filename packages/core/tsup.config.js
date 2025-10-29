// tsup.config.ts
import { defineConfig } from "tsup";
import pkg from "./package.json" assert { type: "json" };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: true,
  minify: true,
  external: [
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ],
});

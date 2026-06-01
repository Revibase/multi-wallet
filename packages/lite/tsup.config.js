// tsup.config.ts
import { defineConfig } from "tsup";
import pkg from "./package.json" assert { type: "json" };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  minify: true,
  external: [
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ],
});

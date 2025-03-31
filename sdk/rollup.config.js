import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";

const env = process.env.NODE_ENV;

export default {
  input: "src/index.ts",
  plugins: [
    commonjs(),
    nodeResolve({
      browser: true,
      extensions: [".js", ".ts"],
      dedupe: ["bn.js", "buffer"],
      preferBuiltins: false,
    }),
    typescript({
      outDir: "dist/browser",
      tsconfig: "./tsconfig.base.json",
      moduleResolution: "node",
      target: "es2019",
      outputToFilesystem: false,
    }),
    replace({
      preventAssignment: true,
      values: {
        "process.env.NODE_ENV": JSON.stringify(env),
        "process.env.ANCHOR_BROWSER": JSON.stringify(true),
      },
    }),
  ],
  external: [
    "@coral-xyz/anchor",
    "bn.js",
    "bs58",
    "buffer",
    "camelcase",
    "eventemitter3",
    "@noble/hashes/sha256",
    "@noble/curves/p256",
    "pako",
    "toml",
    "process",
    "fs",
  ],
  output: {
    file: "dist/browser/index.js",
    format: "es",
    sourcemap: true,
  },
};

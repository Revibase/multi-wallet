import assert from "node:assert/strict";
import {
  RevibaseWallet,
  decompileTransactionToInstructions,
} from "../dist/index.js";
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

/* ---------- 1. Wallet Standard shape test ---------- */
// The constructor only stores the provider; it is not touched until a feature
// is invoked, so a stub is sufficient to validate the discoverable shape.
const wallet = new RevibaseWallet(/** @type {any} */ ({}));

assert.equal(wallet.version, "1.0.0", "version");
assert.equal(wallet.name, "Revibase", "name");
assert.ok(wallet.icon.startsWith("data:image/svg+xml;base64,"), "icon data URI");
assert.deepEqual(
  wallet.chains,
  ["solana:mainnet", "solana:devnet"],
  "chains",
);
assert.deepEqual(wallet.accounts, [], "accounts empty before connect");

const f = wallet.features;
for (const id of [
  "standard:connect",
  "standard:disconnect",
  "standard:events",
  "solana:signAndSendTransaction",
]) {
  assert.ok(f[id], `feature ${id} present`);
  assert.equal(f[id].version, "1.0.0", `feature ${id} version`);
}
assert.ok(
  !("solana:signTransaction" in f),
  "must NOT advertise solana:signTransaction",
);
assert.equal(typeof f["standard:connect"].connect, "function");
assert.equal(typeof f["standard:disconnect"].disconnect, "function");
assert.equal(typeof f["standard:events"].on, "function");
assert.equal(
  typeof f["solana:signAndSendTransaction"].signAndSendTransaction,
  "function",
);
assert.deepEqual(
  f["solana:signAndSendTransaction"].supportedTransactionVersions,
  ["legacy", 0],
  "supportedTransactionVersions",
);

// standard:events on/off round-trip
let changeCalls = 0;
const off = f["standard:events"].on("change", () => changeCalls++);
assert.equal(typeof off, "function", "on() returns unsubscribe");
off();

console.log("✓ shape test passed");

/* ---------- 2. decompile round-trip (no ALTs) ---------- */
const PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ACCOUNT = address("11111111111111111111111111111112");
const PAYER = address("So11111111111111111111111111111111111111112");
const data = new Uint8Array([1, 2, 3, 4]);

const ix = {
  programAddress: PROGRAM,
  accounts: [{ address: ACCOUNT, role: 0 /* readonly, non-signer */ }],
  data,
};

const txMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayer(PAYER, m),
  (m) =>
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: /** @type {any} */ ("11111111111111111111111111111111"),
        lastValidBlockHeight: 0n,
      },
      m,
    ),
  (m) => appendTransactionMessageInstruction(ix, m),
);

const compiled = compileTransaction(txMessage);
const serialized = new Uint8Array(
  getTransactionEncoder().encode(compiled),
);

// rpc is only consulted when address-table lookups exist; this tx has none.
const recovered = await decompileTransactionToInstructions(
  serialized,
  /** @type {any} */ ({}),
);

assert.equal(recovered.length, 1, "one instruction recovered");
assert.equal(recovered[0].programAddress, PROGRAM, "program address preserved");
assert.deepEqual(
  new Uint8Array(recovered[0].data),
  data,
  "instruction data preserved",
);
assert.equal(
  recovered[0].accounts?.[0]?.address,
  ACCOUNT,
  "account address preserved",
);

console.log("✓ decompile round-trip passed");
console.log("\nAll verification checks passed.");

# @revibase/transaction-manager

Server-side transaction verification and policy-based signing for the Revibase multi-wallet system.

This package verifies incoming Solana transaction intents, extracts the on-chain instructions and verified signers, and lets you apply your own allow/deny policies before producing Ed25519 signatures.

---

## Installation

```bash
npm install @revibase/transaction-manager
```

---

## Overview

A **transaction manager** is a server-side signer that:

1. Verifies a transaction request using your rules
2. Applies your business and security policy
3. Signs the Solana **transaction message bytes** (Ed25519)
4. Returns base58-encoded signatures to the caller

Use this package when you want a single, auditable place in your backend where every multi-wallet transaction is verified and approved before it is signed.

---

## Usage

### 1. Generate a transaction manager keypair

Generate one keypair for the manager and keep the private key server-side only.

```ts
import { getBase58Decoder } from "gill";

const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);

const [pubRaw, privJwk] = await Promise.all([
  crypto.subtle.exportKey("raw", keyPair.publicKey),
  crypto.subtle.exportKey("jwk", keyPair.privateKey),
]);

console.log({
  publicKey: getBase58Decoder().decode(new Uint8Array(pubRaw)),
  privateKey: JSON.stringify(privJwk),
});
```

Store:

- **`publicKey`**: as the transaction manager public key (base58).
- **`privateKey`**: as a JWK JSON string in a secure secret store.

### 2. Configure environment

Set the following environment variables for your signing service:

- **`TX_MANAGER_PRIVATE_KEY`**: Manager private key (JWK JSON string).
- **`TX_MANAGER_PUBLIC_KEY`**: Manager public key (base58).
- **`TX_MANAGER_URL`**: Public HTTPS URL of your signing endpoint.
- **`RPC_URL`** (optional): Solana RPC URL. Defaults to `https://api.mainnet-beta.solana.com`.

### 3. Implement a basic signing endpoint

Expose a public HTTPS endpoint, for example:

`https://your-transaction-manager.com/sign`

This endpoint:

- Verifies that the request is intended for this transaction manager.
- Calls `verifyTransaction` to decode and verify the transaction.
- Applies your custom policy.
- Signs the verified transaction message bytes.
- Returns base58-encoded signatures.

```ts
import { verifyTransaction } from "@revibase/transaction-manager";
import { createSolanaRpc, getBase58Decoder } from "gill";
import { enforcePolicies } from "@/lib/policy";

const rpc = createSolanaRpc(
  process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
);

const transactionManagerConfig = {
  publicKey: process.env.TX_MANAGER_PUBLIC_KEY!, // base58
  url: process.env.TX_MANAGER_URL!, // public HTTPS URL of this endpoint
};

export async function POST(req: Request) {
  try {
    const { publicKey, payload } = (await req.json()) as {
      publicKey: string;
      payload: {
        transaction: string;
        transactionMessageBytes?: string;
        authResponses?: unknown[];
      }[];
    };

    if (publicKey !== transactionManagerConfig.publicKey) {
      return Response.json(
        { error: "Invalid transaction manager public key" },
        { status: 400 },
      );
    }

    const jwk = JSON.parse(process.env.TX_MANAGER_PRIVATE_KEY!);
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    );

    const signatures: string[] = [];

    for (const payloadItem of payload) {
      const result = await verifyTransaction(
        rpc,
        transactionManagerConfig,
        payloadItem,
      );

      await enforcePolicies(result);

      const signatureBytes = await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        result.transactionMessage,
      );

      signatures.push(
        getBase58Decoder().decode(new Uint8Array(signatureBytes)),
      );
    }

    return Response.json({ signatures });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
```

---

## Policy checks

Your transaction manager should express your security model in one place.

`verifyTransaction` returns a `VerificationResults` object with:

- **`transactionMessage`**: Raw transaction message bytes to sign.
- **`verificationResults`**: An array of batches, where each batch contains:
  - **`instructions`**: Decoded on-chain instructions.
  - **`signers`**: The signers that successfully passed verification for those instructions.

The example below:

- Allows only native SOL transfers.
- Requires the request to originate from `https://app.revibase.com`.
- Rejects any non-system-program instruction.
- Caps each transfer at **1 SOL**.

```ts
import type { VerificationResults } from "@revibase/transaction-manager";
import {
  SYSTEM_PROGRAM_ADDRESS,
  identifySystemInstruction,
  parseTransferSolInstruction,
  parseTransferSolWithSeedInstruction,
  SystemInstruction,
} from "gill";

const ALLOWED_ORIGINS = new Set(["https://app.revibase.com"]);
const MAX_TRANSFER_LAMPORTS = 1_000_000_000n; // 1 SOL

export async function enforcePolicies(results: VerificationResults) {
  for (const batch of results.verificationResults) {
    const { signers, instructions } = batch;

    for (const signer of signers) {
      const origin = "client" in signer ? signer.client?.origin : undefined;
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        throw new Error("Unauthorized app origin");
      }
    }

    for (const ix of instructions) {
      if (ix.programAddress.toString() !== SYSTEM_PROGRAM_ADDRESS.toString()) {
        throw new Error("Unauthorized program");
      }

      const ixKind = identifySystemInstruction(ix.data);

      if (
        ixKind !== SystemInstruction.TransferSol &&
        ixKind !== SystemInstruction.TransferSolWithSeed
      ) {
        throw new Error("Unauthorized instruction");
      }

      const parsed =
        ixKind === SystemInstruction.TransferSol
          ? parseTransferSolInstruction(ix)
          : parseTransferSolWithSeedInstruction(ix);

      if (parsed.data.amount > MAX_TRANSFER_LAMPORTS) {
        throw new Error("Transfer limit exceeded");
      }
    }
  }
}
```

> ⚠️ **Security note**
>
> The transaction manager private key has full signing authority for any
> transaction that passes your policy checks. Treat it as highly sensitive.

---

## API surface

This package exports the following public API:

- **`verifyTransaction(rpc, transactionManagerConfig, payload, wellKnownProxyUrl?)`**
  - Decodes and verifies a serialized Solana transaction.
  - Returns a `VerificationResults` object with the transaction message bytes and verification batches.

- **`TransactionManagerConfig`**
  - `publicKey`: Transaction manager public key (base58 string).
  - `url`: Public URL of your transaction manager endpoint.

- **`VerificationResults`**
  - `transactionMessage`: Transaction message bytes to sign.
  - `verificationResults`: Array of `{ instructions, signers }` batches used by your policy.

---

## What this package does _not_ do

- ❌ Store private keys for you
- ❌ Enforce your business rules automatically

Those responsibilities remain under your control.

---

## License

MIT

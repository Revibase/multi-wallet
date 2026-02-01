# @revibase/transaction-manager

Transaction verification and policy-based signing for the Revibase multi-wallet system.

This package verifies incoming Solana transaction intents, extracts the on-chain instructions and verified signers, and lets you apply custom allow/deny policies before producing Ed25519 signatures.

---

## Installation

```bash
npm install @revibase/transaction-manager
```

---

## Overview

A **transaction manager** is a server-side signer that:

1. Verifies a transaction request using your custom rules
2. Applies your own business / security policy
3. Signs the Solana **transaction message bytes** (Ed25519)
4. Returns base58-encoded signatures to the caller

---

## Usage

### Basic signing endpoint

```ts
import { verifyTransaction } from "@revibase/transaction-manager";
import { createSolanaRpc, getBase58Encoder } from "gill";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

const transactionManagerConfig = {
  /**
   * Base58-encoded Ed25519 public key of this transaction manager
   */
  publicKey: "YOUR_TRANSACTION_MANAGER_PUBLIC_KEY",

  /**
   * Public URL of this signing endpoint
   */
  url: "https://your-transaction-manager.com/sign",
};

export async function sign(request: Request): Promise<Response> {
  const { publicKey, payload } = await request.json();

  if (publicKey !== transactionManagerConfig.publicKey) {
    return new Response(
      JSON.stringify({ error: "Invalid transaction manager public key" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Load the Ed25519 private key corresponding to `transactionManagerConfig.publicKey`
  const privateKey = await loadTransactionManagerPrivateKey(publicKey);

  const signatures: string[] = [];

  for (const payloadItem of payload) {
    const { messageBytes, verificationResults } = await verifyTransaction(
      rpc,
      transactionManagerConfig,
      payloadItem,
    );

    /**
     * ------------------------------------------------------------------
     * Custom policy enforcement
     * ------------------------------------------------------------------
     *
     * `verificationResults` contains fully verified metadata such as:
     *
     * - `instructions`: decoded Solana instructions that will be sent on-chain
     * - `verifiedSigners`: wallets, members, and credentials involved
     *
     * Use this information to:
     * - allow only transfers
     * - reject config changes
     * - restrict destination addresses
     * - enforce amount limits
     */

    // Sign the Solana *message* bytes (not the full transaction)
    const signatureBytes = await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      messageBytes,
    );

    // Return base58-encoded signatures
    signatures.push(getBase58Encoder().encode(signatureBytes));
  }

  return new Response(JSON.stringify({ signatures }), {
    headers: { "Content-Type": "application/json" },
  });
}
```

---

## Key Management

```ts
async function loadTransactionManagerPrivateKey(
  publicKey: string,
): Promise<CryptoKey> {
  /**
   * Fetch the private key corresponding to `publicKey`.
   *
   * - Must be an Ed25519 private key
   * - SHOULD be stored in a secure system (KMS / HSM / Secrets Manager)
   * - MUST NOT be hard-coded in source code
   */

  const jwk = await fetchPrivateKeyJwkFromSecureStore(publicKey);

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "Ed25519" },
    false, // non-extractable
    ["sign"],
  );
}
```

> ⚠️ **Security note**
>
> The transaction manager private key has full signing authority for any
> transaction that passes your policy checks. Treat it as highly sensitive.

---

## What `verifyTransaction` Does

`verifyTransaction` performs:

- Signature verification of all required members
- Instruction decoding and validation
- Wallet, member, and permission checks

---

## What This Package Does _Not_ Do

- ❌ Store private keys for you
- ❌ Enforce your business rules automatically

Those responsibilities remain under your control.

---

## License

MIT

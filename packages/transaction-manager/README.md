# @revibase/transaction-manager

Transaction verification and processing for the Revibase multi-wallet system.

## Installation

```bash
npm install @revibase/transaction-manager
```

## Usage

```typescript
import { verifyTransaction } from "@revibase/transaction-manager";
import { createSolanaRpc, getBase58Decoder } from "gill";
import { ed25519 } from "@noble/curves/ed25519.js";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
const transactionManagerConfig = {
  publicKey: "YOUR_TRANSACTION_MANAGER_PUBLIC_KEY",
  url: "https://your-transaction-manager.com/sign",
};

export async function sign(request: Request) {
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

  /**
   * Load your transaction manager private key (Ed25519).
   *
   * Rough example only: `ed25519.sign(messageBytes, privateKey)` expects a 32-byte private key.
   * In production, store/fetch this from secure storage (KMS/HSM), not source code.
   */
  const privateKey = await loadTransactionManagerPrivateKey(publicKey);

  const signatures: string[] = [];

  for (const payloadItem of payload) {
    const { messageBytes, verificationResults } = await verifyTransaction(
      rpc,
      transactionManagerConfig,
      payloadItem,
    );

    /**
     * Add custom allow/deny policy (example):
     * Only allow transfer intents (reject config changes, url edits, account creation, etc.).
     *
     * `verificationResults` contains:
     * - `instructions`: the instruction(s) that will be send on chain
     * - `verifiedSigners`: verified signers metadata
     *
     * make use of those parameters to build your own transaction signing policies
     */

    // Sign the Solana transaction MESSAGE bytes (Ed25519) and return base58 signatures.
    const signatureBytes = ed25519.sign(messageBytes, privateKey);
    signatures.push(getBase58Decoder().decode(signatureBytes));
  }

  return new Response(JSON.stringify({ signatures }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function loadTransactionManagerPrivateKey(
  publicKey: string,
): Promise<Uint8Array<ArrayBuffer>> {
  // fetch the corresponding private key for your transaction manager public key
  // - return a 32-byte Ed25519 private key, e.g. from env/KMS.
}
```

## License

MIT

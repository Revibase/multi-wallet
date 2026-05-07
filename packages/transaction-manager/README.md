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
import {
  getBase58Decoder,
  generateExtractableKeyPairSigner,
  extractBytesFromKeyPairSigner,
} from "gill";

const keypair = await generateExtractableKeyPairSigner();
const secretKey = await extractBytesFromKeyPairSigner(keypair);

console.log({
  publicKey: getBase58Decoder().decode(secretKey.slice(32)),
  secretKey: getBase58Decoder().decode(secretKey),
});
```

Store:

- **`publicKey`**: as the transaction manager public key (base58).
- **`secretKey`**: as a base58 string in a secure secret store.

### 2. Configure environment

Set the following environment variables for your signing service:

- **`TX_MANAGER_SECRET_KEY`**: Manager secret key (base58 string).
- **`TX_MANAGER_PUBLIC_KEY`**: Manager public key (base58).
- **`TX_MANAGER_URL`**: Public HTTPS URL of your signing endpoint (the client will connect via WebSocket at the same URL).
- **`RPC_URL`** Solana RPC URL.

### 3. Implement a basic signing endpoint

Expose a public HTTPS endpoint, for example:

`https://your-transaction-manager.com/sign`

This section uses the [`ws`](https://www.npmjs.com/package/ws) package for the WebSocket server:

```bash
npm install ws
```

This endpoint:

- Verifies that the request is intended for this transaction manager.
- Calls `verifyTransaction` to decode and verify the transaction.
- Applies your custom policy.
- Signs the verified transaction message bytes.
- Returns base58-encoded signatures.

```ts
import {
  initialize,
  type CompleteMessageRequest,
  type TransactionAuthDetails,
  verifyMessage,
  verifyTransaction,
} from "@revibase/transaction-manager";
import {
  getBase58Decoder,
  createKeypairSignerFromBase58,
  signBytes,
} from "gill";
import { enforcePolicies } from "@/lib/policy";
import http from "node:http";
import { WebSocketServer } from "ws";

initialize({
  rpcEndpoint: process.env.RPC_URL,
});

const transactionManagerConfig = {
  publicKey: process.env.TX_MANAGER_PUBLIC_KEY!, // base58
  url: process.env.TX_MANAGER_URL!, // public HTTPS URL of this endpoint
};

/**
 * The @revibase/core client connects using WebSocket (wss://...) and sends one JSON message.
 * This is the exact shape produced by createTransactionManagerSigner():
 *
 * Transaction signing:
 * {
 *   type: "transaction",
 *   data: {
 *     publicKey: string,
 *     payload: Array<{
 *       transaction: string,
 *       transactionMessageBytes?: string,
 *       authResponses?: TransactionAuthDetails[],
 *     }>,
 *   }
 * }
 *
 * Message signing:
 * {
 *   type: "message",
 *   data: {
 *      publicKey: string,
 *      payload: CompleteMessageRequest
 *    }
 * }
 *
 * Your service should respond with JSON events:
 * - { event: "signatures", data: { signatures: string[] } }  // base58 signatures
 * - { event: "error", data: { error: string } }
 *
 * (Optional) approval UX:
 * - { event: "pending_transaction_approval", data: { validTill: number } }
 * - { event: "transaction_approved", data: {} }
 */
const server = http.createServer();

// Route upgrade requests for "/sign" to WebSocket.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/sign") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", async (ws) => {
  try {
    // Read exactly one request message from the client.
    const msg = (await readJsonOnce(ws)) as {
      type: string;
      data?: unknown;
    };
    if (msg.type !== "transaction" && msg.type !== "message") {
      ws.send(
        JSON.stringify({
          event: "error",
          data: { error: `Unsupported request type: ${msg.type}` },
        }),
      );
      ws.close();
      return;
    }

    // Shared: load signer key once per connection.
    const { keyPair } = await createKeypairSignerFromBase58(
      process.env.TX_MANAGER_SECRET_KEY!,
    );

    if (msg.type === "transaction") {
      const { publicKey, payload } = (msg.data ?? {}) as {
        publicKey: string;
        payload: {
          transaction: string;
          transactionMessageBytes?: string;
          authResponses?: TransactionAuthDetails[];
        }[];
      };

      if (publicKey !== transactionManagerConfig.publicKey) {
        ws.send(
          JSON.stringify({
            event: "error",
            data: { error: "Invalid transaction manager public key" },
          }),
        );
        ws.close();
        return;
      }

      const signatures: string[] = [];
      for (const payloadItem of payload) {
        const { messageBytes, verificationResults } = await verifyTransaction(
          transactionManagerConfig,
          payloadItem,
        );

        await enforcePolicies(verificationResults);

        // (Optional) if your policy requires an out-of-band human approval:
        // ws.send(JSON.stringify({ event: "pending_transaction_approval", data: { validTill: Date.now() + 60_000 } }));

        // await waitForYourApprovalSystem(...);

        // ws.send(JSON.stringify({ event: "transaction_approved", data: {} }));

        const signatureBytes = await signBytes(
          keyPair.privateKey,
          messageBytes,
        );

        signatures.push(getBase58Decoder().decode(signatureBytes));
      }

      ws.send(JSON.stringify({ event: "signatures", data: { signatures } }));
      ws.close();
    } else {
      // msg.type === "message"
      const { publicKey, payload } = (msg.data ?? {}) as {
        publicKey: string;
        payload: CompleteMessageRequest;
      };

      if (publicKey !== transactionManagerConfig.publicKey) {
        ws.send(
          JSON.stringify({
            event: "error",
            data: { error: "Invalid transaction manager public key" },
          }),
        );
        ws.close();
        return;
      }

      const { messageBytes, verificationResults } = await verifyMessage(
        publicKey,
        payload,
      );

      // (Optional) if your policy requires an out-of-band human approval:

      // ws.send(JSON.stringify({ event: "pending_transaction_approval", data: { validTill: Date.now() + 60_000 } }));

      // await waitForYourApprovalSystem(...);

      // ws.send(JSON.stringify({ event: "transaction_approved", data: {} }));

      const signatureBytes = await signBytes(keyPair.privateKey, messageBytes);

      ws.send(
        JSON.stringify({
          event: "signatures",
          data: {
            signatures: [getBase58Decoder().decode(signatureBytes)],
          },
        }),
      );
      ws.close();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      ws.send(JSON.stringify({ event: "error", data: { error: msg } }));
    } finally {
      ws.close();
    }
  }
});

server.listen(3000, () => {
  console.log("Transaction manager listening on http://localhost:3000/sign");
});

function readJsonOnce(ws: import("ws").WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: import("ws").RawData) => {
      try {
        const text = typeof data === "string" ? data : data.toString("utf8");
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      } finally {
        ws.off("message", onMessage);
      }
    };
    ws.on("message", onMessage);
  });
}
```

---

## Policy checks

Your transaction manager should express your security model in one place.

`verifyTransaction` returns a `VerifyTransactionResult` object with:

- **`messageBytes`**: Raw transaction message bytes to sign.
- **`verificationResults`**: An array of batches, where each batch contains:
  - **`instructions`**: Decoded on-chain instructions.
  - **`signers`**: The signers that successfully passed verification for those instructions.

The example below:

- Allows only native SOL transfers.
- Requires the request to originate from `https://app.revibase.com`.
- Rejects any non-system-program instruction.
- Caps each transfer at **1 SOL**.

```ts
import type { ExpectedTransactionSigner } from "@revibase/transaction-manager";
import type { Instruction } from "gill";
import {
  SYSTEM_PROGRAM_ADDRESS,
  identifySystemInstruction,
  parseTransferSolInstruction,
  parseTransferSolWithSeedInstruction,
  SystemInstruction,
} from "gill";

const ALLOWED_ORIGINS = new Set(["https://app.revibase.com"]);
const MAX_TRANSFER_LAMPORTS = 1_000_000_000n; // 1 SOL

export async function enforcePolicies(
  verificationResults: {
    instructions: Instruction[];
    signers: ExpectedTransactionSigner[];
  }[],
) {
  for (const batch of verificationResults) {
    const { signers, instructions } = batch;

    for (const signer of signers) {
      // Only secp256r1/passkey signers include `client` metadata (origin + client JWK).
      if ("client" in signer && !ALLOWED_ORIGINS.has(signer.client.origin)) {
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

- **`verifyTransaction(transactionManagerConfig, payload, getClientDetails?)`**
  - Decodes and verifies a serialized Solana transaction.
  - Returns a `VerifyTransactionResult` object with the transaction message bytes and verification batches.

- **`verifyMessage(publicKey, payload, getClientDetails?)`**
  - Verifies a sign-in / message authorization payload (`CompleteMessageRequest`).
  - Returns a `VerifyMessageResult` containing:
    - `messageBytes`: the message bytes to sign (Ed25519).
    - `verificationResults`: the verified payload plus the extracted signer metadata.
  - Uses `payload.data.payload.startRequest.rpId` and `payload.data.payload.startRequest.clientOrigin` for WebAuthn verification (RP ID + expected origin).

- **`TransactionManagerConfig`**
  - `publicKey`: Transaction manager public key (base58 string).
  - `url`: Public URL of your transaction manager endpoint.

- **`VerifyTransactionResult`**
  - `messageBytes`: Transaction message bytes to sign.
  - `verificationResults`: Array of `{ instructions, signers }` batches used by your policy.

---

## What this package does _not_ do

- ❌ Store private keys for you
- ❌ Enforce your business rules automatically

Those responsibilities remain under your control.

---

## License

MIT

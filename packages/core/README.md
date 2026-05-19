# @revibase/core

Core types and helpers for Revibase multi-wallet: transfer intents and custom vault-paid transactions (sync or Jito bundles).

**Contents:** [Initialize](#initialize) → [Create user](#create-a-user-account) → [Create wallet](#create-a-wallet) → [Transfer intents](#transfer-intents) → [Custom transactions](#custom-transactions-sync-vs-chunked-bundle) (sync or chunked).

---

## Initialize

Call `initialize()` once before using helpers that rely on shared RPC clients (for example `getSolanaRpc()`).

```ts
import { initialize } from "@revibase/core";

initialize({
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
  // proverEndpoint?: string;
  // compressionApiEndpoint?: string;
});
```

---

## Create a user account

Create one or more user accounts. Each user is identified by a member key (e.g. an Ed25519 signer) and a role. The helper returns an instruction—send it in a transaction with your Solana client.

```ts
import { createUserAccounts, UserRole } from "@revibase/core";
import type { TransactionSigner } from "gill";

declare const payer: TransactionSigner;
declare const memberSigner: TransactionSigner;

const createUserIx = await createUserAccounts({
  payer,
  createUserArgs: { member: memberSigner, role: UserRole.Member },
});
// Build a tx with createUserIx; sign with payer + memberSigner, then send.
```

---

## Create a wallet

Create a wallet (settings + vault) with an existing user as the initial member. The user must exist first (see [Create a user account](#create-a-user-account)). Use the global counter for the next wallet index, then optionally set this wallet as the user’s delegate.

```ts
import {
  createWallet,
  editUserDelegate,
  fetchGlobalCounter,
  getGlobalCounterAddress,
  getSolanaRpc,
} from "@revibase/core";
import type { TransactionSigner } from "gill";

declare const payer: TransactionSigner;
declare const memberSigner: TransactionSigner;

const globalCounter = await fetchGlobalCounter(
  getSolanaRpc(),
  await getGlobalCounterAddress(),
);

const createWalletIx = await createWallet({
  index: globalCounter.data.index,
  payer,
  initialMember: memberSigner,
});

// Build a tx with createWalletIx; sign with payer + memberSigner, then send.

const setWalletAsDelegateIx = await editUserDelegate({
  payer,
  user: memberSigner,
  newDelegate: Number(globalCounter.data.index),
});

// Build a tx with setWalletAsDelegateIx; sign with payer + memberSigner, then send.
```

After confirmation, use [Resolve delegated wallet settings](#1-resolve-delegated-wallet-settings) with this index to get `settings` and `walletAddress` for transfers or custom transactions.

---

## Transfer intents

Move SOL or SPL tokens from a multi-wallet via on-chain intent instructions.

### 1. Resolve delegated wallet settings

Using the member signer, get the delegated wallet’s settings PDA and vault address:

```ts
import {
  fetchSettings,
  fetchUser,
  getSettingsFromIndex,
  getSolanaRpc,
  getUserAddress,
  getWalletAddressFromSettings,
} from "@revibase/core";
import type { TransactionSigner } from "gill";

declare const memberSigner: TransactionSigner;

const user = (
  await fetchUser(getSolanaRpc(), await getUserAddress(memberSigner.address))
).data;
const delegatedWallet = user.wallets.find((w) => w.isDelegate);
if (!delegatedWallet)
  throw new Error("memberSigner is not delegated to any wallet");

const settingsIndex = delegatedWallet.index;
const settings = await getSettingsFromIndex(settingsIndex);
const settingsAccount = (await fetchSettings(getSolanaRpc(), settings)).data;
const walletAddress = await getWalletAddressFromSettings(settings);
```

Use `settings`, `settingsAccount`, and (optionally) `walletAddress` in the following steps.

### 2. Native SOL transfer

```ts
import {
  createTransactionManagerSigner,
  fetchUser,
  getSolanaRpc,
  getUserAddress,
  nativeTransferIntent,
  retrieveTransactionManager,
} from "@revibase/core";
import type { TransactionSigner } from "gill";

declare const payer: TransactionSigner;
declare const memberSigner: TransactionSigner;
declare const destination: string;

// For wallets with a transaction manager, add its signer. See [step 2](#2-transaction-manager-signer-when-required).
const tmResult = retrieveTransactionManager(
  memberSigner.address.toString(),
  settingsAccount,
);
let transactionManagerSigner: TransactionSigner | null = null;
if (tmResult !== null) {
  const userAccountData = (
    await fetchUser(
      getSolanaRpc(),
      await getUserAddress(tmResult.transactionManagerAddress),
    )
  ).data;
  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error("Transaction manager endpoint is missing for this account");
  }
  transactionManagerSigner = createTransactionManagerSigner({
    address: tmResult.transactionManagerAddress,
    url: userAccountData.transactionManagerUrl.value,
  });
}

const instructions = await nativeTransferIntent({
  settings,
  destination,
  amount: 100_000n, // lamports
  signers: [
    memberSigner,
    ...(transactionManagerSigner ? [transactionManagerSigner] : []),
  ],
});
// Build tx from instructions with prepareTransactionMessage (or similar), then send.
```

### 4. SPL / Token-2022 transfer

```ts
import {
  createTransactionManagerSigner,
  fetchUser,
  getSolanaRpc,
  getUserAddress,
  retrieveTransactionManager,
  tokenTransferIntent,
} from "@revibase/core";
import type { Address, TransactionSigner } from "gill";
import { TOKEN_2022_PROGRAM_ADDRESS } from "gill/programs";

declare const payer: TransactionSigner;
declare const memberSigner: TransactionSigner;
declare const destinationWallet: Address;
declare const mint: Address;

const tmResult = retrieveTransactionManager(
  memberSigner.address.toString(),
  settingsAccount,
);
let transactionManagerSigner: TransactionSigner | null = null;
if (tmResult !== null) {
  const userAccountData = (
    await fetchUser(
      getSolanaRpc(),
      await getUserAddress(tmResult.transactionManagerAddress),
    )
  ).data;
  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error("Transaction manager endpoint is missing for this account");
  }
  transactionManagerSigner = createTransactionManagerSigner({
    address: tmResult.transactionManagerAddress,
    url: userAccountData.transactionManagerUrl.value,
  });
}

const instructions = await tokenTransferIntent({
  settings,
  payer,
  signers: [
    memberSigner,
    ...(transactionManagerSigner ? [transactionManagerSigner] : []),
  ],
  destination: destinationWallet,
  amount: 1_000_000n,
  mint,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
});
// Build tx from instructions, then send. Same signer pattern as native transfer if using a transaction manager.
```

---

## Custom transactions (sync vs chunked bundle)

- **Small tx size** → **sync**: `prepareTransactionMessage` → `prepareTransactionSync` → send
- **Larger tx size** → **chunked bundle**: `prepareTransactionMessage` → `prepareTransactionBundle` → send the returned transactions in order

In both cases, use `getSendAndConfirmTransaction()` (after `initialize()`) or your own Gill client to send.

Prerequisite: `settings`, `walletAddress`, and `settingsAccount` from [Resolve delegated wallet settings](#1-resolve-delegated-wallet-settings).

### Sync: prepareTransactionSync

```ts
import {
  createTransactionManagerSigner,
  fetchUser,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  getUserAddress,
  prepareTransactionMessage,
  prepareTransactionSync,
  retrieveTransactionManager,
} from "@revibase/core";
import {
  createNoopSigner,
  type Address,
  type AddressesByLookupTableAddress,
  type TransactionSigner,
} from "gill";
import { getTransferSolInstruction } from "gill/programs";

declare const destination: Address;
declare const payer: TransactionSigner;
declare const memberSigner: TransactionSigner;
declare const addressLookups: AddressesByLookupTableAddress | undefined;

const transferIx = getTransferSolInstruction({
  source: createNoopSigner(walletAddress),
  destination,
  amount: 1_000_000n,
});

const transactionMessageBytes = prepareTransactionMessage({
  payer: walletAddress,
  instructions: [transferIx],
  addressesByLookupTableAddress: addressLookups,
});

const tmResult = retrieveTransactionManager(
  memberSigner.address.toString(),
  settingsAccount,
);
let transactionManagerSigner: TransactionSigner | null = null;
if (tmResult !== null) {
  const userAccountData = (
    await fetchUser(
      getSolanaRpc(),
      await getUserAddress(tmResult.transactionManagerAddress),
    )
  ).data;
  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error("Transaction manager endpoint is missing for this account");
  }
  transactionManagerSigner = createTransactionManagerSigner({
    address: tmResult.transactionManagerAddress,
    url: userAccountData.transactionManagerUrl.value,
    transactionMessageBytes,
  });
}

const details = await prepareTransactionSync({
  payer,
  settings,
  transactionMessageBytes,
  signers: [
    memberSigner,
    ...(transactionManagerSigner ? [transactionManagerSigner] : []),
  ],
  addressesByLookupTableAddress: addressLookups,
});

const sendAndConfirm = getSendAndConfirmTransaction();
const signature = await sendAndConfirm({
  payer: details.payer,
  instructions: details.instructions,
  addressesByLookupTableAddress: details.addressesByLookupTableAddress,
});
```

### Chunked bundle: prepareTransactionBundle

`prepareTransactionBundle()` returns multiple `TransactionDetails` objects (create buffer → extend buffer chunks → approvals → execute). Submit them in order.

```ts
import {
  createTransactionManagerSigner,
  fetchUser,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  getUserAddress,
  prepareTransactionMessage,
  prepareTransactionBundle,
  retrieveTransactionManager,
} from "@revibase/core";
import {
  createNoopSigner,
  type Address,
  type AddressesByLookupTableAddress,
  type TransactionSigner,
} from "gill";
import { getTransferSolInstruction } from "gill/programs";

declare const destination: Address;
declare const payer: TransactionSigner;
declare const memberSigner: TransactionSigner;
declare const addressLookups: AddressesByLookupTableAddress | undefined;

const transferIx = getTransferSolInstruction({
  source: createNoopSigner(walletAddress),
  destination,
  amount: 1_000_000n,
});
const transactionMessageBytes = prepareTransactionMessage({
  payer: walletAddress,
  instructions: [transferIx],
  addressesByLookupTableAddress: addressLookups,
});

const tmResult = retrieveTransactionManager(
  memberSigner.address.toString(),
  settingsAccount,
);
let transactionManagerSigner: TransactionSigner | null = null;
if (tmResult !== null) {
  const userAccountData = (
    await fetchUser(
      getSolanaRpc(),
      await getUserAddress(tmResult.transactionManagerAddress),
    )
  ).data;
  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error("Transaction manager endpoint is missing for this account");
  }
  transactionManagerSigner = createTransactionManagerSigner({
    address: tmResult.transactionManagerAddress,
    url: userAccountData.transactionManagerUrl.value,
    transactionMessageBytes,
  });
}

const bundle = await prepareTransactionBundle({
  payer,
  settings,
  transactionMessageBytes,
  creator: transactionManagerSigner ?? memberSigner,
  executor: transactionManagerSigner ? memberSigner : undefined,
  addressesByLookupTableAddress: addressLookups,
  jitoBundlesTipAmount: 10_000, // optional, lamports
});

const sendAndConfirm = getSendAndConfirmTransaction();
let lastSignature: string | undefined;
for (const tx of bundle) {
  lastSignature = await sendAndConfirm({
    payer: tx.payer,
    instructions: tx.instructions,
    addressesByLookupTableAddress: tx.addressesByLookupTableAddress,
  });
}
```

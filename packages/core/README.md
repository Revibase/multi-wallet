# @revibase/core

Core types and helpers for Revibase multi-wallet: transfer intents and custom vault-paid transactions (sync or Jito bundles).

**Contents:** [Initialize](#initialize) → [Create user](#create-a-user-account) → [Create wallet](#create-a-wallet) → [Transfer intents](#transfer-intents) → [Custom transactions](#custom-transactions-sync-vs-chunked-bundle) (sync or chunked).

---

## Initialize

Call `initialize()` once before using helpers that rely on shared RPC clients (for example `getSolanaRpc()` or compressed account helpers).

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
  createUserArgs: [{ member: memberSigner, role: UserRole.Member }],
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
  newDelegate: {
    index: globalCounter.data.index,
    settingsAddressTreeIndex: 0,
  },
});

// Build a tx with setWalletAsDelegateIx; sign with payer + memberSigner, then send.
```

After confirmation, use [Resolve settings and compressed flag](#1-resolve-settings-and-compressed-flag) with this index to get `settings`, `compressed`, and `walletAddress` for transfers or custom transactions.

---

## Transfer intents

Move SOL or SPL tokens from a multi-wallet via on-chain intent instructions.

### 1. Resolve settings and compressed flag

Using the member signer, get the delegated wallet’s settings and compression flag:

```ts
import {
  fetchUserAccountData,
  fetchSettingsAccountData,
  getSettingsFromIndex,
  getWalletAddressFromSettings,
} from "@revibase/core";
import type { TransactionSigner } from "gill";

declare const memberSigner: TransactionSigner;

const user = await fetchUserAccountData(memberSigner.address);
const delegatedWallet = user.wallets.find((w) => w.isDelegate);
if (!delegatedWallet)
  throw new Error("memberSigner is not delegated to any wallet");

const settingsIndex = delegatedWallet.index;
const settings = await getSettingsFromIndex(settingsIndex);
const settingsAccount = await fetchSettingsAccountData(settings);
const compressed = settingsAccount.isCompressed;
const walletAddress = await getWalletAddressFromSettings(settings);
```

Use `settings`, `compressed`, and (optionally) `walletAddress` in the following steps.

### 2. Transaction manager signer (when required)

If the wallet uses a [transaction manager](https://github.com/Revibase/multi-wallet/tree/main/packages/transaction-manager) member, add its signer for the native/SPL steps below and for [custom transactions](#custom-transactions-sync-vs-bundle). The manager’s HTTPS URL is stored on-chain on that member’s user account.

1. After you have `settingsAccount`, call `retrieveTransactionManager(memberAddress, settingsAccount)`. It returns **`null`** when the member already has Initiate, Vote, and Execute (no transaction manager signer is required). Otherwise it returns **`{ transactionManagerAddress, userAddressTreeIndex }`** — then load the user account with `fetchUserAccountData(transactionManagerAddress, userAddressTreeIndex)` and read `transactionManagerUrl` (a Gill `Option`: use it when `__option === "Some"` via `.value`).
2. Call `createTransactionManagerSigner({ address, url, authResponses?, transactionMessageBytes?, onPendingApprovalsCallback?, onPendingApprovalsSuccess?, abortController?, opts? })` to obtain a `TransactionSigner`.

### 3. Native SOL transfer

```ts
import {
  createTransactionManagerSigner,
  fetchUserAccountData,
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
  const userAccountData = await fetchUserAccountData(
    tmResult.transactionManagerAddress,
    tmResult.userAddressTreeIndex,
  );
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
  payer,
  compressed,
});
// Build tx from instructions with prepareTransactionMessage (or similar), then send.
```

### 4. SPL / Token-2022 transfer

```ts
import {
  createTransactionManagerSigner,
  fetchUserAccountData,
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
  const userAccountData = await fetchUserAccountData(
    tmResult.transactionManagerAddress,
    tmResult.userAddressTreeIndex,
  );
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
  compressed,
});
// Build tx from instructions, then send. Same signer pattern as native transfer if using a transaction manager.
```

---

## Custom transactions (sync vs chunked bundle)

- **Small tx size** → **sync**: `prepareTransactionMessage` → `prepareTransactionSync` → send
- **Larger tx size** → **chunked bundle**: `prepareTransactionMessage` → `prepareTransactionBundle` → send the returned transactions in order

In both cases, use `getSendAndConfirmTransaction()` (after `initialize()`) or your own Gill client to send.

Prerequisite: `settings`, `compressed`, `walletAddress`, and `settingsAccount` from [Resolve settings and compressed flag](#1-resolve-settings-and-compressed-flag).

### Sync: prepareTransactionSync

```ts
import {
  createTransactionManagerSigner,
  fetchUserAccountData,
  getSendAndConfirmTransaction,
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
  const userAccountData = await fetchUserAccountData(
    tmResult.transactionManagerAddress,
    tmResult.userAddressTreeIndex,
  );
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
  compressed,
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
  fetchUserAccountData,
  getSendAndConfirmTransaction,
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
  const userAccountData = await fetchUserAccountData(
    tmResult.transactionManagerAddress,
    tmResult.userAddressTreeIndex,
  );
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
  compressed,
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

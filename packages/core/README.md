# @revibase/core

Core types and helpers for Revibase multi-wallet: transfer intents and custom vault-paid transactions (sync or Jito bundles).

**Contents:** [Create user](#create-a-user-account) → [Create wallet](#create-a-wallet) → [Transfer intents](#transfer-intents) (SOL / SPL) → [Custom transactions](#custom-transactions-sync-vs-bundle) (sync or Jito).

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

### 2. Native SOL transfer

```ts
import {
  nativeTransferIntent,
  retrieveTransactionManager,
  getSignedTransactionManager,
} from "@revibase/core";
import type { TransactionSigner } from "gill";

declare const payer: TransactionSigner;
declare const memberSigner: TransactionSigner;
declare const destination: string;

// For wallets with a transaction manager, add its signer. See Custom transactions for full flow.
const tmResult = retrieveTransactionManager(
  memberSigner.address.toString(),
  settingsAccount,
);
const transactionManagerSigner =
  "transactionManagerAddress" in tmResult
    ? await getSignedTransactionManager({
        transactionManagerAddress: tmResult.transactionManagerAddress,
        userAddressTreeIndex: tmResult.userAddressTreeIndex,
      })
    : null;

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

### 3. SPL / Token-2022 transfer

```ts
import {
  tokenTransferIntent,
  retrieveTransactionManager,
  getSignedTransactionManager,
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
const transactionManagerSigner =
  "transactionManagerAddress" in tmResult
    ? await getSignedTransactionManager({
        transactionManagerAddress: tmResult.transactionManagerAddress,
        userAddressTreeIndex: tmResult.userAddressTreeIndex,
      })
    : null;

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

## Custom transactions (sync vs bundle)

- **Small tx size** → **sync**: `prepareTransactionMessage` → `prepareTransactionSync` → `signAndSendTransaction`
- **Larger tx size** → **Jito bundle**: `prepareTransactionMessage` → `prepareTransactionBundle` → `signAndSendBundledTransactions`

Prerequisite: `settings`, `compressed`, `walletAddress`, and `settingsAccount` from [Resolve settings and compressed flag](#1-resolve-settings-and-compressed-flag).

### Sync: prepareTransactionSync

```ts
import {
  prepareTransactionMessage,
  prepareTransactionSync,
  signAndSendTransaction,
  retrieveTransactionManager,
  getSignedTransactionManager,
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

const { transactionManagerAddress, userAddressTreeIndex } =
  retrieveTransactionManager(memberSigner.address.toString(), settingsAccount);
const transactionManagerSigner = await getSignedTransactionManager({
  transactionMessageBytes,
  transactionManagerAddress,
  userAddressTreeIndex,
});

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

const signature = await signAndSendTransaction(details);
```

### Jito bundle

```ts
import {
  prepareTransactionMessage,
  prepareTransactionBundle,
  signAndSendBundledTransactions,
  pollJitoBundleConfirmation,
  retrieveTransactionManager,
  getSignedTransactionManager,
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

const { transactionManagerAddress, userAddressTreeIndex } =
  retrieveTransactionManager(memberSigner.address.toString(), settingsAccount);
const transactionManagerSigner = await getSignedTransactionManager({
  transactionMessageBytes,
  transactionManagerAddress,
  userAddressTreeIndex,
});

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

const bundleId = await signAndSendBundledTransactions(bundle);
const signature = await pollJitoBundleConfirmation(bundleId);
```

import {
  type AddressesByLookupTableAddress,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  getSignatureFromTransaction,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import { type CompressedSettingsData } from "../../generated";
import {
  type BundleResponse,
  Permission,
  Permissions,
  TransactionManagerPermission,
} from "../../types";
import { fetchUserAccountData } from "../compressed";
import {
  convertMemberKeyToString,
  createTransactionManagerSigner,
} from "../helper";
import {
  getComputeBudgetEstimate,
  getConfirmRecentTransaction,
  getGlobalAuthorizedClient,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  getSolanaRpcEndpoint,
} from "../initialize";
import { getMedianPriorityFees, sendJitoBundle } from "../transactionMessage";

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return arraysEqual(a, b);
}
interface Indexed<T> {
  length: number;
  [index: number]: T;
}

export function arraysEqual<T>(a: Indexed<T>, b: Indexed<T>): boolean {
  if (a === b) return true;

  const length = a.length;
  if (length !== b.length) return false;

  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export function createSignInMessageText(input: {
  domain: string;
  nonce: string;
}): string {
  let message = `${input.domain} wants you to sign in with your Solana account`;

  const fields: string[] = [];

  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}

async function simulateBundle(bundle: string[], connectionUrl: string) {
  if (bundle.length === 0) {
    throw new Error("Bundle is empty.");
  }

  for (let i = 0; i < bundle.length; i++) {
    if (bundle[i].length > 1644) {
      throw new Error(
        `Transaction ${i} exceeds maximum length, ${bundle[i].length}. Retry again.`
      );
    }
    console.log(`Transaction ${i} length: ${bundle[i].length}`);
  }

  const response = await fetch(connectionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "2",
      method: "simulateBundle",
      params: [
        {
          encodedTransactions: bundle,
        },
        {
          skipSigVerify: true,
          replaceRecentBlockhash: true,
          preExecutionAccountsConfigs: bundle.map(() => ({
            encoding: "base64",
            addresses: [],
          })),
          postExecutionAccountsConfigs: bundle.map(() => ({
            encoding: "base64",
            addresses: [],
          })),
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error(await response.json());
    throw new Error("Failed to simulate bundle");
  }
  const { result, error } = await response.json();

  if (!result || error) {
    console.error(error ?? result);
    throw new Error(
      `Unable to simulate bundle: ${JSON.stringify(error ?? result)}`
    );
  }
  if (typeof result.value.summary !== "string" && result.value.summary.failed) {
    const { TransactionFailure } = result.value.summary.failed.error;
    const [, programError] = TransactionFailure;
    console.error(error ?? result);
    throw new Error(`Simulation failed: ${programError}`);
  }

  return result.value.transactionResults.map((x: any) => x.unitsConsumed);
}

export async function sendBundleTransaction(bundle: BundleResponse[]) {
  const simulationBundle = await createEncodedBundle(bundle, true);
  const computeUnits = await simulateBundle(
    simulationBundle.map(getBase64EncodedWireTransaction),
    getSolanaRpcEndpoint()
  );
  const encodedBundle = await createEncodedBundle(
    bundle.map((x, index) => ({
      ...x,
      unitsConsumed: computeUnits[index],
    }))
  );
  await sendJitoBundle(encodedBundle.map(getBase64EncodedWireTransaction));

  const transaction = encodedBundle[encodedBundle.length - 1];
  const lastValidBlockHeight =
    transaction.lifetimeConstraint.lastValidBlockHeight;
  const signature = getSignatureFromTransaction(transaction);
  await getConfirmRecentTransaction()({
    signature,
    lastValidBlockHeight,
    commitment: "confirmed",
  });
  return signature;
}

export async function sendNonBundleTransaction(
  instructions: Instruction[],
  payer: TransactionSigner,
  addressesByLookupTableAddress: AddressesByLookupTableAddress | undefined
) {
  const latestBlockHash = await getSolanaRpc().getLatestBlockhash().send();
  const tx = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions([...instructions], tx),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockHash.value, tx),
    (tx) =>
      addressesByLookupTableAddress
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            addressesByLookupTableAddress
          )
        : tx,
    async (tx) => {
      const [estimatedUnits, priorityFees] = await Promise.all([
        getComputeBudgetEstimate()(tx),
        getMedianPriorityFees(
          getSolanaRpc(),
          tx.instructions.flatMap((x) => x.accounts ?? [])
        ),
      ]);
      const computeUnits = Math.ceil(estimatedUnits * 1.1);
      return prependTransactionMessageInstructions(
        [
          ...(computeUnits > 200000
            ? [
                getSetComputeUnitLimitInstruction({
                  units: computeUnits,
                }),
              ]
            : []),
          ...(priorityFees > 0
            ? [
                getSetComputeUnitPriceInstruction({
                  microLamports: priorityFees,
                }),
              ]
            : []),
        ],
        tx
      );
    },
    async (tx) => await signTransactionMessageWithSigners(await tx)
  );
  await getSendAndConfirmTransaction()(tx, {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return getSignatureFromTransaction(tx);
}

async function createEncodedBundle(
  bundle: {
    id: string;
    payer: TransactionSigner;
    ixs: Instruction[];
    addressLookupTableAccounts?: AddressesByLookupTableAddress;
    unitsConsumed?: number;
  }[],
  isSimulate = false
) {
  const latestBlockHash = isSimulate
    ? {
        blockhash: getBlockhashDecoder().decode(
          crypto.getRandomValues(new Uint8Array(32))
        ),
        lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
      }
    : (await getSolanaRpc().getLatestBlockhash().send()).value;
  return await Promise.all(
    bundle.map(async (x) => {
      const tx = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => appendTransactionMessageInstructions(x.ixs, tx),
        (tx) => setTransactionMessageFeePayerSigner(x.payer, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockHash, tx),
        (tx) =>
          x.addressLookupTableAccounts
            ? compressTransactionMessageUsingAddressLookupTables(
                tx,
                x.addressLookupTableAccounts
              )
            : tx,
        async (tx) => {
          const computeUnits =
            Math.ceil((x.unitsConsumed ?? 0) * 1.1) || 800000;
          return computeUnits > 200000
            ? prependTransactionMessageInstructions(
                [
                  getSetComputeUnitLimitInstruction({
                    units: computeUnits,
                  }),
                ],
                tx
              )
            : tx;
        },
        async (tx) =>
          isSimulate
            ? compileTransaction(await tx)
            : await signTransactionMessageWithSigners(await tx)
      );
      return tx;
    })
  );
}
export async function resolveTransactionManagerSigner({
  memberKey,
  settingsData,
  transactionMessageBytes,
  authorizedClient = getGlobalAuthorizedClient(),
  cachedAccounts,
}: {
  memberKey: string;
  settingsData: CompressedSettingsData;
  transactionMessageBytes?: ReadonlyUint8Array;
  authorizedClient?: {
    publicKey: string;
    url: string;
  } | null;
  cachedAccounts?: Map<string, any>;
}) {
  if (settingsData.threshold > 1) {
    throw new Error(
      "Multi-signature transactions with threshold > 1 are not supported yet."
    );
  }
  const member = settingsData.members.find(
    (m) => convertMemberKeyToString(m.pubkey) === memberKey
  );
  if (!member) {
    throw new Error("No permissions found for the current member.");
  }
  const { permissions } = member;
  const hasInitiate = Permissions.has(
    permissions,
    Permission.InitiateTransaction
  );
  const hasVote = Permissions.has(permissions, Permission.VoteTransaction);
  const hasExecute = Permissions.has(
    permissions,
    Permission.ExecuteTransaction
  );
  // If member has full signing rights, no transaction manager is needed
  if (hasInitiate && hasVote && hasExecute) {
    return null;
  }

  // Otherwise, require a transaction manager + vote + execute rights
  const transactionManager = settingsData.members.find((m) =>
    Permissions.has(m.permissions, TransactionManagerPermission)
  );
  if (!transactionManager) {
    throw new Error("No transaction manager available in wallet.");
  }
  if (!hasVote || !hasExecute) {
    throw new Error("Member lacks the required Vote/Execute permissions.");
  }

  const transactionManagerAddress = address(
    convertMemberKeyToString(transactionManager.pubkey)
  );

  const userAccountData = await fetchUserAccountData(
    transactionManagerAddress,
    cachedAccounts
  );

  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error(
      "Transaction manager endpoint is missing for this account."
    );
  }

  return createTransactionManagerSigner(
    transactionManagerAddress,
    userAccountData.transactionManagerUrl.value,
    transactionMessageBytes,
    authorizedClient
  );
}

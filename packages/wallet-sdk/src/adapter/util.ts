import {
  address,
  type AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  assertIsTransactionWithinSizeLimit,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  getSignatureFromTransaction,
  getUtf8Decoder,
  type Instruction,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type SignaturesMap,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import { type CompressedSettingsData, fetchUserExtensions } from "../generated";
import {
  type BundleResponse,
  Permission,
  Permissions,
  TransactionManagerPermission,
} from "../types";
import {
  convertMemberKeyToString,
  createTransactionManagerSigner,
  getComputeBudgetEstimate,
  getConfirmRecentTransaction,
  getMedianPriorityFees,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  getSolanaRpcEndpoint,
  getUserExtensionsAddress,
  sendJitoBundle,
} from "../utils";

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

export function assertTransactionIsNotSigned(signatures: SignaturesMap) {
  const missingSigs = [];
  Object.entries(signatures).forEach(([address, signatureBytes]) => {
    if (!signatureBytes) {
      missingSigs.push(address);
    }
  });
  if (missingSigs.length !== Object.entries(signatures).length) {
    throw new Error("Transaction cannot be partially signed.");
  }
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

export const ADDRESS_BY_LOOKUP_TABLE_ADDRESS: AddressesByLookupTableAddress = {
  [address("3XSDsD3YPrU6UfZVGzoUra63tqhLSysWK9bR3YWPQmiw")]: [
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    "Sysvar1nstructions1111111111111111111111111",
    "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg",
    "SysvarS1otHashes111111111111111111111111111",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "3C6AdJiD9qxMqZTmB53b5HC5Yfq2Bb57XAzYDzu4YDcj",
    "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
    "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
    "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
    "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy",
    "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
    "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh",
    "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA",
    "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
    "smt1NamzXdq4AMqS2fS2F1i5KTYPZRhoHgWx38d8WsT",
    "nfq1NvQDJ2GEgnS8zt9prAe8rjjpAW1zFkrvZoBR148",
    "amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2",
    "aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F",
    "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
    "6MZszp7ihPjUeoi8RJs9NNC4jBxi7beiqvXHJhxd7fe",
    "smt2rJAFdyJJupwMKAqTNAJwvjhmiZ4JYGZmbVRw1Ho",
    "nfq2hgS7NYemXsFaFUCe3EMXSDSfnZnAe27jC6aPP1X",
    "smt3AFtReRGVcrP11D6bSLEaKdUmrGfaTNowMVccJeu",
    "nfq3de4qt9d3wHxXWy1wcge3EXhid25mCr12bNWFdtV",
    "smt4vjXvdjDFzvRMUxwTWnSy4c7cKkMaHuPrGsdDH7V",
    "nfq4Ncp1vk3mFnCQ9cvwidp9k2L6fxEyCo2nerYD25A",
    "smt5uPaQT9n6b1qAkgyonmzRxtuazA53Rddwntqistc",
    "nfq5b5xEguPtdD6uPetZduyrB5EUqad7gcUE46rALau",
    "smt6ukQDSPPYHSshQovmiRUjG9jGFq2hW9vgrDFk5Yz",
    "nfq6uzaNZ5n3EWF4t64M93AWzLGt5dXTikEA9fFRktv",
    "smt7onMFkvi3RbyhQCMajudYQkB1afAFt9CDXBQTLz6",
    "nfq7yytdKkkLabu1KpvLsa5VPkvCT4jPWus5Yi74HTH",
    "smt8TYxNy8SuhAdKJ8CeLtDkr2w6dgDmdz5ruiDw9Y9",
    "nfq8vExDykci3VUSpj9R1totVst87hJfFWevNK4hiFb",
    "smt9ReAYRF5eFjTd5gBJMn5aKwNRcmp3ub2CQr2vW7j",
    "nfq9KFpNQL45ppP6ZG7zBpUeN18LZrNGkKyvV1kjTX2",
    "smtAvYA5UbTRyKAkAj5kHs1CmrA42t6WkVLi4c6mA1f",
    "nfqAroCRkcZBgsAJDNkptKpsSWyM6cgB9XpWNNiCEC4",
    "2cLqZJrYMuCzKdSZBoWxZ3tXoeCMmMyDiuy6UBaKnbmK",
    "5tgzUZaVtfnnSEBgmBDtJj6PdgYCnA1uaEGEUi3y5Njg",
  ].map(address),
};

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
  assertIsTransactionWithinSizeLimit(tx);
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
            Math.ceil((x.unitsConsumed ?? 0) * 1.1) || 800_000;
          return computeUnits > 200_000
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
  authorisedClients,
}: {
  memberKey: string;
  settingsData: CompressedSettingsData;
  transactionMessageBytes: Uint8Array;
  authorisedClients?: {
    publicKey: string;
    url: string;
  };
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

  const userExtensions = await fetchUserExtensions(
    getSolanaRpc(),
    await getUserExtensionsAddress(transactionManagerAddress)
  );

  if (userExtensions.data.apiUrlLen === 0) {
    throw new Error(
      "Transaction manager endpoint is missing for this account."
    );
  }
  const apiUrl = getUtf8Decoder().decode(
    userExtensions.data.apiUrl.slice(0, userExtensions.data.apiUrlLen)
  );

  return createTransactionManagerSigner(
    transactionManagerAddress,
    apiUrl,
    transactionMessageBytes,
    authorisedClients
  );
}

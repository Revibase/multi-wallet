import {
  AccountRole,
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
  type AccountMeta,
  type AddressesByLookupTableAddress,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import type { BundleResponse } from "../../types";
import {
  getComputeBudgetEstimate,
  getConfirmRecentTransaction,
  getJitoTipsConfig,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  getSolanaRpcEndpoint,
} from "../initialize";

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
async function sendJitoBundle(
  serializedTransactions: string[],
  maxRetries = 10,
  delayMs = 1000
): Promise<string> {
  const { jitoBlockEngineUrl } = getJitoTipsConfig();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${jitoBlockEngineUrl}/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [
          serializedTransactions,
          {
            encoding: "base64",
          },
        ],
      }),
    });

    if (response.status === 429) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `Error sending bundles: ${JSON.stringify(data.error, null, 2)}`
      );
    }

    return data.result as string;
  }

  throw new Error("Failed to send bundle after retries.");
}
async function getMedianPriorityFees(
  connection: Rpc<SolanaRpcApi>,
  accounts: AccountMeta[]
) {
  const recentFees = await connection
    .getRecentPrioritizationFees(
      accounts
        .filter(
          (x) =>
            x.role === AccountRole.WRITABLE ||
            x.role === AccountRole.WRITABLE_SIGNER
        )
        .map((x) => x.address)
    )
    .send();
  const fees = recentFees.map((f) => Number(f.prioritizationFee));
  fees.sort((a, b) => a - b);
  const mid = Math.floor(fees.length / 2);

  if (fees.length % 2 === 0) {
    return Math.round((fees[mid - 1] + fees[mid]) / 2);
  } else {
    return fees[mid];
  }
}
export async function estimateJitoTips(jitoTipsConfig = getJitoTipsConfig()) {
  const { estimateJitoTipsEndpoint, priority } = jitoTipsConfig;
  const response = await fetch(estimateJitoTipsEndpoint);
  const result = await response.json();
  const tipAmount = Math.round(result[0][priority] * 10 ** 9) as number;
  return tipAmount;
}

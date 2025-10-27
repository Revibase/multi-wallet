import {
  type AccountMeta,
  AccountRole,
  type AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  pipe,
  prependTransactionMessageInstructions,
  type ReadonlyUint8Array,
  type Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type SolanaRpcApi,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import { prepareTransactionSync } from "../../transaction";
import { SignedSecp256r1Key, type TransactionDetails } from "../../types";
import { getJitoTipsConfig, getSolanaRpc } from "../initialize";

export async function createEncodedBundle(
  bundle: (TransactionDetails & { unitsConsumed?: number })[],
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
        (tx) => appendTransactionMessageInstructions(x.instructions, tx),
        (tx) => setTransactionMessageFeePayerSigner(x.payer, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockHash, tx),
        (tx) =>
          x.addressesByLookupTableAddress
            ? compressTransactionMessageUsingAddressLookupTables(
                tx,
                x.addressesByLookupTableAddress
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
export async function getMedianPriorityFees(
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

export async function simulateBundle(bundle: string[], connectionUrl: string) {
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

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return arraysEqual(a, b);
}
interface Indexed<T> {
  length: number;
  [index: number]: T;
}

function arraysEqual<T>(a: Indexed<T>, b: Indexed<T>): boolean {
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

export function simulateSecp256r1Signer() {
  const randomPubkey = crypto.getRandomValues(new Uint8Array(33));
  const signer = new SignedSecp256r1Key(randomPubkey, {
    originIndex: 0,
    crossOrigin: false,
    authData: crypto.getRandomValues(new Uint8Array(37)),
    domainConfig: getAddressDecoder().decode(
      crypto.getRandomValues(new Uint8Array(32))
    ),
    signature: crypto.getRandomValues(new Uint8Array(64)),
    verifyArgs: {
      slotHash: crypto.getRandomValues(new Uint8Array(32)),
      slotNumber: BigInt(0),
      truncatedClientDataJson: crypto.getRandomValues(new Uint8Array(100)),
      clientDataJson: crypto.getRandomValues(new Uint8Array(250)),
    },
  });
  return signer;
}

export async function estimateTransactionSizeExceedLimit({
  payer,
  settingsIndex,
  transactionMessageBytes,
  signers,
  compressed,
  addressesByLookupTableAddress,
  cachedAccounts,
}: {
  payer: TransactionSigner;
  transactionMessageBytes: ReadonlyUint8Array;
  settingsIndex: number;
  compressed: boolean;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signers: (TransactionSigner | SignedSecp256r1Key)[];
  cachedAccounts?: Map<string, any>;
}) {
  const result = await prepareTransactionSync({
    payer,
    index: settingsIndex,
    transactionMessageBytes,
    signers,
    compressed,
    simulateProof: true,
    addressesByLookupTableAddress,
    cachedAccounts,
  });

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(result.instructions, tx),
    (tx) => setTransactionMessageFeePayerSigner(result.payer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: getBlockhashDecoder().decode(
            crypto.getRandomValues(new Uint8Array(32))
          ),
          lastValidBlockHeight: BigInt(Number.MAX_SAFE_INTEGER),
        },
        tx
      ),
    (tx) =>
      result.addressesByLookupTableAddress
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            result.addressesByLookupTableAddress
          )
        : tx,
    (tx) =>
      prependTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({
            units: 800_000,
          }),
          getSetComputeUnitPriceInstruction({
            microLamports: 1000,
          }),
        ],
        tx
      ),

    (tx) => compileTransaction(tx)
  );
  const txSize = getBase64EncodedWireTransaction(tx).length;
  console.log("Estimated Tx Size: ", txSize);
  return txSize > 1644;
}
export async function estimateJitoTips(jitoTipsConfig = getJitoTipsConfig()) {
  const { estimateJitoTipsEndpoint, priority } = jitoTipsConfig;
  const response = await fetch(estimateJitoTipsEndpoint);
  const result = await response.json();
  const tipAmount = Math.round(result[0][priority] * 10 ** 9) as number;
  return tipAmount;
}

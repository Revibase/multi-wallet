import {
  type AccountMeta,
  AccountRole,
  type AddressesByLookupTableAddress,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getBlockhashDecoder,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "gill";
import {
  getAddMemoInstruction,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import type { Secp256r1VerifyInput } from "../../instructions";
import { prepareTransactionSync } from "../../transaction";
import { Secp256r1Key } from "../../types";
import { getJitoTipsConfig } from "../initialize";

export function simulateSecp256r1Signer() {
  const randomPubkey = crypto.getRandomValues(new Uint8Array(33));
  const signer = new Secp256r1Key(randomPubkey, {
    authData: crypto.getRandomValues(new Uint8Array(37)),
    domainConfig: getAddressDecoder().decode(
      crypto.getRandomValues(new Uint8Array(32))
    ),
    signature: crypto.getRandomValues(new Uint8Array(64)),
    verifyArgs: {
      slotHash: crypto.getRandomValues(new Uint8Array(32)),
      slotNumber: BigInt(0),
      clientDataJson: crypto.getRandomValues(new Uint8Array(150)),
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
  memo,
  secp256r1VerifyInput,
  cachedAccounts,
}: {
  payer: TransactionSigner;
  transactionMessageBytes: Uint8Array;
  settingsIndex: number;
  compressed: boolean;
  addressesByLookupTableAddress?: AddressesByLookupTableAddress;
  signers: (TransactionSigner | Secp256r1Key)[];
  secp256r1VerifyInput?: Secp256r1VerifyInput;
  memo?: string | null;
  cachedAccounts?: Map<string, any>;
}) {
  const result = await prepareTransactionSync({
    payer,
    index: settingsIndex,
    transactionMessageBytes,
    signers,
    secp256r1VerifyInput,
    compressed,
    simulateProof: true,
    addressesByLookupTableAddress,
    cachedAccounts,
  });

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) =>
      appendTransactionMessageInstructions(
        memo
          ? [getAddMemoInstruction({ memo }), ...result.ixs]
          : [...result.ixs],
        tx
      ),
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
      result.addressLookupTableAccounts
        ? compressTransactionMessageUsingAddressLookupTables(
            tx,
            result.addressLookupTableAccounts
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function sendJitoBundle(
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
        await delay(delayMs);
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

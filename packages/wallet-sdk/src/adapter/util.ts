import {
  AccountMeta,
  AccountRole,
  address,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  Rpc,
  SignatureBytes,
  SignaturesMap,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { SolanaSignInInput } from "@solana/wallet-standard-features";

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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendJitoBundle(
  jitoBlockEngineUrl: string,
  serializedTransactions: string[],
  maxRetries = 10,
  delayMs = 1000
): Promise<string> {
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

async function fetchRandomPayer(apiEndpoint: string) {
  const response = await fetch(`${apiEndpoint}/getRandomPayer`);
  const result = (await response.json()) as { randomPayer: string };
  return result.randomPayer;
}

export async function getRandomPayer(
  apiEndpoint = `https://api.revibase.com`
): Promise<TransactionSigner> {
  const payer = await fetchRandomPayer(apiEndpoint);
  return {
    address: address(payer),
    signTransactions(transactions) {
      return new Promise(async (resolve, reject) => {
        try {
          const signatureResponse = await fetch(`${apiEndpoint}/sign`, {
            method: "POST",
            body: JSON.stringify({
              publicKey: payer,
              transactions: transactions.map((x) =>
                getBase64Decoder().decode(getTransactionEncoder().encode(x))
              ),
            }),
          });
          if (!signatureResponse.ok) {
            throw new Error(await signatureResponse.text());
          }
          const { signatures } = (await signatureResponse.json()) as {
            signatures: string[];
          };
          resolve(
            signatures.map((x) => ({
              [address(payer)]: getBase58Encoder().encode(x) as SignatureBytes,
            }))
          );
        } catch (error) {
          reject(error);
        }
      });
    },
  };
}

export function createSignInMessageText(input: SolanaSignInInput): string {
  // ${domain} wants you to sign in with your Solana account:
  // ${address}
  //
  // ${statement}
  //
  // URI: ${uri}
  // Version: ${version}
  // Chain ID: ${chain}
  // Nonce: ${nonce}
  // Issued At: ${issued-at}
  // Expiration Time: ${expiration-time}
  // Not Before: ${not-before}
  // Request ID: ${request-id}
  // Resources:
  // - ${resources[0]}
  // - ${resources[1]}
  // ...
  // - ${resources[n]}

  let message = `${input.domain} wants you to sign in with your Solana account`;
  message += input.address ? `:\n${input.address}` : `.`;

  if (input.statement) {
    message += `\n\n${input.statement}`;
  }

  const fields: string[] = [];
  if (input.uri) {
    fields.push(`URI: ${input.uri}`);
  }
  if (input.version) {
    fields.push(`Version: ${input.version}`);
  }
  if (input.chainId) {
    fields.push(`Chain ID: ${input.chainId}`);
  }
  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`);
  }
  if (input.issuedAt) {
    fields.push(`Issued At: ${input.issuedAt}`);
  }
  if (input.expirationTime) {
    fields.push(`Expiration Time: ${input.expirationTime}`);
  }
  if (input.notBefore) {
    fields.push(`Not Before: ${input.notBefore}`);
  }
  if (input.requestId) {
    fields.push(`Request ID: ${input.requestId}`);
  }
  if (input.resources) {
    fields.push(`Resources:`);
    for (const resource of input.resources) {
      fields.push(`- ${resource}`);
    }
  }
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}

export interface JitoTipsConfig {
  estimateJitoTipsEndpoint: string;
  priority:
    | "landed_tips_25th_percentile"
    | "landed_tips_50th_percentile"
    | "landed_tips_75th_percentile"
    | "landed_tips_95th_percentile"
    | "landed_tips_99th_percentile"
    | "ema_landed_tips_50th_percentile";
}

export async function estimateJitoTips({
  estimateJitoTipsEndpoint,
  priority = "ema_landed_tips_50th_percentile",
}: JitoTipsConfig) {
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

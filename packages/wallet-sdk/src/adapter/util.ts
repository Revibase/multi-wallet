import {
  address,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  SignatureBytes,
  SignaturesMap,
  TransactionSigner,
} from "@solana/kit";
import { SolanaSignInInput } from "@solana/wallet-standard-features";

export const JITO_API_URL = `https://mainnet.block-engine.jito.wtf/api/v1`;

export const PAYERS_ENDPOINT = `https://payers.revibase.com`;

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

export async function estimateJitoTips() {
  const response = await fetch(
    "https://bundles.jito.wtf/api/v1/bundles/tip_floor"
  );
  const result = await response.json();
  const tipAmount = Math.round(
    result[0]["ema_landed_tips_50th_percentile"] * 10 ** 9
  ) as number;

  return tipAmount;
}

export async function sendJitoBundle(serializedTransactions: string[]) {
  const response = await fetch(`${JITO_API_URL}/bundles`, {
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
  const data = await response.json();
  if (data.error) {
    throw new Error(
      `Error sending bundles: ${JSON.stringify(data.error, null, 2)}`
    );
  }
  return data.result;
}

export async function pollJitoBundleForConfirmation(
  bundleId: string,
  timeoutMs = 30000,
  pollIntervalMs = 3000,
  waitBeforePollMs = 5000
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, waitBeforePollMs));
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const bundleStatus = await getJitoBundleStatus([bundleId]);
      const status = bundleStatus.value[0]?.confirmation_status ?? "Unknown";

      if (status === "confirmed" || status === "finalized") {
        const transactions = bundleStatus.value[0]?.transactions;
        return transactions[transactions.length - 1] ?? bundleId;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch {
      console.error("❌ - Error polling bundle status.");
    }
  }
  throw new Error("Polling timeout reached without confirmation");
}

export const getJitoBundleStatus = async (bundleIds: string[]) => {
  const response = await fetch(`${JITO_API_URL}/getBundleStatuses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBundleStatuses",
      params: [bundleIds],
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(
      `Error getting bundle statuses: ${JSON.stringify(data.error, null, 2)}`
    );
  }
  return data.result;
};

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

async function fetchRandomPayer() {
  const result = await fetch(`${PAYERS_ENDPOINT}`);
  return (await result.text()).replace(/"/g, "");
}

export async function getRandomPayer(): Promise<TransactionSigner> {
  const payer = await fetchRandomPayer();
  return {
    address: address(payer),
    signTransactions(transactions) {
      return new Promise(async (resolve, reject) => {
        try {
          const signatures = await Promise.all(
            transactions.map(async (x) => {
              const signatureResponse = await fetch(`${PAYERS_ENDPOINT}/sign`, {
                method: "POST",
                body: JSON.stringify({
                  publicKey: payer,
                  transaction: getBase64Decoder().decode(
                    getTransactionEncoder().encode(x)
                  ),
                }),
              });
              if (!signatureResponse.ok) {
                throw new Error(await signatureResponse.text());
              }
              const { signature } = (await signatureResponse.json()) as {
                signature: string;
              };

              return getBase58Encoder().encode(signature);
            })
          );
          resolve(
            signatures.map((x) => ({ [address(payer)]: x as SignatureBytes }))
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

  let message = `${input.domain} wants you to sign in with your Solana account\n`;
  message += `:${input.address}`;

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

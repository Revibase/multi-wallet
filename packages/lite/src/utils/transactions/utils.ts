import {
  createTransactionManagerSigner,
  fetchUser,
  getSolanaRpc,
  getUserAddress,
  type TransactionAuthDetails,
} from "@revibase/core";
import {
  address,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  type Address,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type TransactionSigner,
} from "@solana/kit";
import { REVIBASE_API_ENDPOINT } from "../consts";
import { withRetry } from "../retry";

const payerCache = new Map<string, TransactionSigner>();

export async function getRandomPayer(): Promise<TransactionSigner> {
  const cached = payerCache.get(REVIBASE_API_ENDPOINT);
  if (cached) return cached;

  const response = await withRetry(() =>
    fetch(`${REVIBASE_API_ENDPOINT}/getRandomPayer`),
  );

  if (!response.ok) {
    throw new Error(`Failed to get random payer: ${response.statusText}`);
  }

  const { randomPayer } = (await response.json()) as { randomPayer: string };
  const payer = createTransactionSigner(
    address(randomPayer),
    `${REVIBASE_API_ENDPOINT}/sign`,
  );
  payerCache.set(REVIBASE_API_ENDPOINT, payer);
  return payer;
}

function createTransactionSigner(
  publicKey: Address,
  url: string,
): TransactionSigner {
  const payer: TransactionSigner = {
    address: publicKey,
    async signTransactions(transactions) {
      const payload = {
        publicKey: publicKey,
        transactions: transactions.map((tx) =>
          getBase64Decoder().decode(getTransactionEncoder().encode(tx)),
        ),
      };

      const signResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!signResponse.ok) {
        throw new Error(
          `Failed to sign transactions: ${signResponse.statusText}`,
        );
      }

      const data = (await signResponse.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      return data.signatures.map((sig) => ({
        [publicKey]: getBase58Encoder().encode(sig) as SignatureBytes,
      }));
    },
  };

  return payer;
}

export async function getTransactionManagerSigner(args: {
  transactionManagerAddress: Address | undefined;
  authResponses?: TransactionAuthDetails[];
  transactionMessageBytes?: ReadonlyUint8Array;
  onPendingApprovalsCallback?: (validTill: number) => void;
  onPendingApprovalsSuccess?: () => void;
  abortSignal?: AbortSignal;
}) {
  const {
    transactionManagerAddress,
    transactionMessageBytes,
    authResponses,
    onPendingApprovalsCallback,
    onPendingApprovalsSuccess,
    abortSignal,
  } = args;
  let url;
  if (transactionManagerAddress) {
    const txManagerUrl = (
      await withRetry(async () =>
        fetchUser(
          getSolanaRpc(),
          await getUserAddress(transactionManagerAddress),
        ),
      )
    ).data.transactionManagerUrl;
    url = txManagerUrl.__option === "Some" ? txManagerUrl.value : null;
  }

  const transactionManagerSigner =
    transactionManagerAddress && url
      ? createTransactionManagerSigner({
          address: transactionManagerAddress,
          url,
          authResponses,
          transactionMessageBytes,
          onPendingApprovalsCallback,
          onPendingApprovalsSuccess,
          abortSignal,
        })
      : null;

  return transactionManagerSigner;
}

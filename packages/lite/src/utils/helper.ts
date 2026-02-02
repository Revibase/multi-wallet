import {
  address,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";

const payerCache = new Map<string, TransactionSigner>();

export async function getRandomPayer(
  payerEndpoint: string
): Promise<TransactionSigner> {
  const cached = payerCache.get(payerEndpoint);
  if (cached) return cached;

  const response = await fetch(`${payerEndpoint}/getRandomPayer`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Failed to get random payer: ${response.statusText}`);
  }

  const { randomPayer } = (await response.json()) as { randomPayer: string };

  const payer: TransactionSigner = {
    address: address(randomPayer),
    async signTransactions(transactions) {
      const payload = {
        publicKey: randomPayer,
        transactions: transactions.map((tx) =>
          getBase64Decoder().decode(getTransactionEncoder().encode(tx))
        ),
      };

      const signResponse = await fetch(`${payerEndpoint}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!signResponse.ok) {
        throw new Error(
          `Failed to sign transactions: ${signResponse.statusText}`
        );
      }

      const data = (await signResponse.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      return data.signatures.map((sig) => ({
        [address(randomPayer)]: getBase58Encoder().encode(
          sig
        ) as SignatureBytes,
      }));
    },
  };

  payerCache.set(payerEndpoint, payer);
  return payer;
}

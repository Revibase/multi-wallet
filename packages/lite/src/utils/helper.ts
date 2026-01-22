import {
  address,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";

/**
 * Fetches a random payer from the API and returns a transaction signer.
 * The payer can be used to pay transaction fees.
 *
 * @param payerEndpoint - Base URL of the payer API endpoint
 * @returns Transaction signer that can sign transactions on behalf of the payer
 * @throws {Error} If the API request fails or returns an error
 */

const payerCache = new Map<string, TransactionSigner>();

export async function getRandomPayer(
  payerEndpoint: string,
): Promise<TransactionSigner> {
  // Check cache first
  const cached = payerCache.get(payerEndpoint);
  if (cached) return cached;

  // Fetch new payer
  const response = await fetch(`${payerEndpoint}/getRandomPayer`, {
    signal: AbortSignal.timeout(5000), // 5s timeout
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
          getBase64Decoder().decode(getTransactionEncoder().encode(tx)),
        ),
      };

      const signResponse = await fetch(`${payerEndpoint}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10s timeout
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
        [address(randomPayer)]: getBase58Encoder().encode(
          sig,
        ) as SignatureBytes,
      }));
    },
  };

  // Cache the payer for this endpoint
  payerCache.set(payerEndpoint, payer);
  return payer;
}

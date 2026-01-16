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
export async function getRandomPayer(
  payerEndpoint: string
): Promise<TransactionSigner> {
  const response = await fetch(`${payerEndpoint}/getRandomPayer`);
  
  if (!response.ok) {
    throw new Error(
      `Failed to fetch random payer: ${response.status} ${response.statusText}`
    );
  }

  const { randomPayer } = (await response.json()) as { randomPayer: string };

  if (!randomPayer) {
    throw new Error("Invalid response: randomPayer is missing");
  }

  return {
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
      });

      if (!signResponse.ok) {
        throw new Error(
          `Failed to sign transactions: ${signResponse.status} ${signResponse.statusText}`
        );
      }

      const data = (await signResponse.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new Error(`Transaction signing failed: ${data.error}`);
      }

      if (!Array.isArray(data.signatures)) {
        throw new Error("Invalid response: signatures must be an array");
      }

      return data.signatures.map((sig) => ({
        [address(randomPayer)]: getBase58Encoder().encode(
          sig
        ) as SignatureBytes,
      }));
    },
  };
}

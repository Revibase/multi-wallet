import {
  createTransactionManagerSigner,
  fetchUserAccountData,
  getSolanaRpc,
  type AccountCache,
  type TransactionAuthDetails,
} from "@revibase/core";
import {
  address,
  fetchAddressesForLookupTables,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  type Address,
  type AddressesByLookupTableAddress,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";
import { fetchMaybeAddressLookupTable } from "gill/programs";
import {
  REVIBASE_API_ENDPOINT,
  REVIBASE_LOOKUP_TABLE_ADDRESS,
} from "../consts";

const payerCache = new Map<string, TransactionSigner>();

export async function getRandomPayer(): Promise<TransactionSigner> {
  const cached = payerCache.get(REVIBASE_API_ENDPOINT);
  if (cached) return cached;

  const response = await fetch(`${REVIBASE_API_ENDPOINT}/getRandomPayer`, {
    signal: AbortSignal.timeout(5000),
  });

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
        signal: AbortSignal.timeout(10000),
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
  userAddressTreeIndex: number | undefined;
  authResponses?: TransactionAuthDetails[];
  transactionMessageBytes?: ReadonlyUint8Array;
  onPendingApprovalsCallback?: (validTill: number) => void;
  onPendingApprovalsSuccess?: () => void;
  abortController?: AbortController;
  abortSignal?: AbortSignal;
  cachedAccounts?: AccountCache;
}) {
  const {
    transactionManagerAddress,
    transactionMessageBytes,
    userAddressTreeIndex,
    authResponses,
    onPendingApprovalsCallback,
    onPendingApprovalsSuccess,
    abortController: abortControllerArg,
    abortSignal,
    cachedAccounts,
  } = args;

  let abortController = abortControllerArg;
  if (abortSignal && !abortController) {
    const ac = new AbortController();
    if (abortSignal.aborted) {
      ac.abort();
    } else {
      abortSignal.addEventListener("abort", () => ac.abort(), { once: true });
    }
    abortController = ac;
  }
  let url;
  if (transactionManagerAddress) {
    const txManagerUrl = (
      await fetchUserAccountData(
        transactionManagerAddress,
        userAddressTreeIndex,
        cachedAccounts,
      )
    ).transactionManagerUrl;
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
          abortController,
        })
      : null;

  return transactionManagerSigner;
}

export async function fetchAdditionalLoopUpTableIfNecessary(
  addressesByLookupTableAddress?: AddressesByLookupTableAddress,
) {
  if (!addressesByLookupTableAddress) {
    return await fetchAddressesForLookupTables(
      [address(REVIBASE_LOOKUP_TABLE_ADDRESS)],
      getSolanaRpc(),
    );
  }

  if (REVIBASE_LOOKUP_TABLE_ADDRESS in addressesByLookupTableAddress) {
    return addressesByLookupTableAddress;
  }

  const fetched = await fetchMaybeAddressLookupTable(
    getSolanaRpc(),
    address(REVIBASE_LOOKUP_TABLE_ADDRESS),
  );

  if (fetched.exists) {
    return {
      ...addressesByLookupTableAddress,
      [fetched.address]: fetched.data.addresses,
    };
  }

  return addressesByLookupTableAddress;
}

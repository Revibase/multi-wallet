import {
  address,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  prependTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "gill/programs";
import {
  UserRole,
  type CompressedSettingsData,
  type MemberKey,
} from "../../generated";
import {
  KeyType,
  Permission,
  Permissions,
  type TransactionAuthDetails,
  type TransactionDetails,
} from "../../types";
import { fetchUserAccountData } from "../compressed";
import {
  getComputeBudgetEstimate,
  getJitoTipsConfig,
  getSendAndConfirmTransaction,
  getSolanaRpc,
  getSolanaRpcEndpoint,
} from "../initialize";
import {
  createEncodedBundle,
  getMedianPriorityFees,
  simulateBundle,
} from "./internal";

export async function signAndSendBundledTransactions(
  bundle: TransactionDetails[]
) {
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
  const bundleId = await sendJitoBundle(
    encodedBundle.map(getBase64EncodedWireTransaction)
  );
  return bundleId;
}

/**
 * By default, median priority fees are added to the transaction
 */
export async function signAndSendTransaction({
  instructions,
  payer,
  addressesByLookupTableAddress,
}: TransactionDetails) {
  const latestBlockHash = await getSolanaRpc().getLatestBlockhash().send();
  const tx = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
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

export async function sendJitoBundle(
  serializedTransactions: string[],
  maxRetries = 10,
  delayMs = 1000,
  jitoTipsConfig = getJitoTipsConfig()
): Promise<string> {
  const { blockEngineUrl: jitoBlockEngineUrl } = jitoTipsConfig;
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
export async function pollJitoBundleConfirmation(
  bundleId: string,
  maxRetries = 30,
  delayMs = 3000,
  jitoTipsConfig = getJitoTipsConfig()
): Promise<string> {
  const { blockEngineUrl: jitoBlockEngineUrl } = jitoTipsConfig;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${jitoBlockEngineUrl}/getBundleStatuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBundleStatuses",
        params: [[bundleId]],
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

    const results = data.result as {
      context: {
        slot: number;
      };
      value: {
        bundle_id: string;
        transactions: string[];
        slot: number;
        confirmation_status: "processed" | "confirmed" | "finalized";
        err: {
          Ok: null;
        };
      }[];
    };

    if (results.value.length) {
      const value = results.value[0];
      if (
        value.confirmation_status === "confirmed" ||
        value.confirmation_status === "finalized"
      ) {
        return value.transactions[value.transactions.length - 1];
      }
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
  }

  throw new Error("Failed to get bundle status after retries.");
}

export function retrieveTransactionManager(
  signer: string,
  settingsData: CompressedSettingsData & {
    isCompressed: boolean;
  }
) {
  if (settingsData.threshold > 1) {
    throw new Error(
      "Multi-signature transactions with threshold > 1 are not supported yet."
    );
  }
  const { permissions } =
    settingsData.members.find(
      (m) => convertMemberKeyToString(m.pubkey) === signer
    ) ?? {};
  if (!permissions) {
    throw new Error("No permissions found for the current member.");
  }
  const hasInitiate = Permissions.has(
    permissions,
    Permission.InitiateTransaction
  );
  const hasVote = Permissions.has(permissions, Permission.VoteTransaction);
  const hasExecute = Permissions.has(
    permissions,
    Permission.ExecuteTransaction
  );
  // If signer has full signing rights, no transaction manager is needed
  if (hasInitiate && hasVote && hasExecute) {
    return {};
  }
  if (!hasVote || !hasExecute) {
    throw new Error("Signer lacks the required Vote/Execute permissions.");
  }

  // Otherwise, require a transaction manager + vote + execute rights
  const transactionManager = settingsData.members.find(
    (m) => m.role === UserRole.TransactionManager
  );
  if (!transactionManager) {
    throw new Error("No transaction manager available in wallet.");
  }

  return {
    transactionManagerAddress: address(
      convertMemberKeyToString(transactionManager.pubkey)
    ),
    userAddressTreeIndex: transactionManager.userAddressTreeIndex,
  };
}
export async function getSignedTransactionManager({
  authResponses,
  transactionManagerAddress,
  userAddressTreeIndex,
  transactionMessageBytes,
  cachedAccounts,
}: {
  authResponses: TransactionAuthDetails[];
  transactionManagerAddress?: Address;
  transactionMessageBytes?: ReadonlyUint8Array;
  userAddressTreeIndex?: number;
  cachedAccounts?: Map<string, any>;
}) {
  if (!transactionManagerAddress) return null;
  const userAccountData = await fetchUserAccountData(
    transactionManagerAddress,
    userAddressTreeIndex,
    cachedAccounts
  );

  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new Error(
      "Transaction manager endpoint is missing for this account."
    );
  }

  return createTransactionManagerSigner(
    transactionManagerAddress,
    userAccountData.transactionManagerUrl.value,
    authResponses,
    transactionMessageBytes
  );
}

export function createTransactionManagerSigner(
  address: Address,
  url: string,
  authResponses?: TransactionAuthDetails[],
  transactionMessageBytes?: ReadonlyUint8Array
): TransactionSigner {
  return {
    address,
    async signTransactions(transactions) {
      const payload: Record<
        string,
        string | string[] | TransactionAuthDetails[]
      > = {
        publicKey: address.toString(),
        transactions: transactions.map(getBase64EncodedWireTransaction),
      };

      if (transactionMessageBytes) {
        payload.transactionMessageBytes = getBase64Decoder().decode(
          transactionMessageBytes
        );
      }
      if (authResponses) {
        payload.authResponses = authResponses;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      return data.signatures.map((sig) => ({
        [address]: getBase58Encoder().encode(sig) as SignatureBytes,
      }));
    },
  };
}
export function convertMemberKeyToString(memberKey: MemberKey) {
  if (memberKey.keyType === KeyType.Ed25519) {
    return getBase58Decoder().decode(memberKey.key.subarray(1, 33));
  } else {
    return getBase58Decoder().decode(memberKey.key);
  }
}

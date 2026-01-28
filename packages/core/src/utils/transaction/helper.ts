/**
 * Transaction manager utilities for handling multi-signature transactions
 */

import {
  address,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  getU32Decoder,
  getU32Encoder,
  type Address,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";
import {
  NetworkError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from "../../errors";
import {
  getConfigActionDecoder,
  getConfigActionEncoder,
  UserRole,
  type CompressedSettingsData,
  type ConfigAction,
  type MemberKey,
} from "../../generated";
import type { AccountCache } from "../../types";
import {
  KeyType,
  Permission,
  Permissions,
  type TransactionAuthDetails,
} from "../../types";
import { fetchUserAccountData } from "../compressed";

/**
 * Retrieves transaction manager configuration for a signer
 * @param signer - The signer's public key as a string
 * @param settingsData - Compressed settings data
 * @returns Transaction manager configuration or empty object if not needed
 * @throws {ValidationError} If threshold > 1 (not supported)
 * @throws {NotFoundError} If signer is not found in members
 * @throws {PermissionError} If signer lacks required permissions
 */
export function retrieveTransactionManager(
  signer: string,
  settingsData: CompressedSettingsData & {
    isCompressed: boolean;
  },
) {
  if (settingsData.threshold > 1) {
    throw new ValidationError(
      "Multi-signature transactions with threshold > 1 are not supported yet.",
    );
  }
  const member = settingsData.members.find(
    (m) => convertMemberKeyToString(m.pubkey) === signer,
  );
  if (!member) {
    throw new NotFoundError("Member", `Signer ${signer} not found in settings`);
  }

  const { permissions } = member;
  if (!permissions) {
    throw new NotFoundError(
      "Permissions",
      "No permissions found for the current member",
    );
  }
  const hasInitiate = Permissions.has(
    permissions,
    Permission.InitiateTransaction,
  );
  const hasVote = Permissions.has(permissions, Permission.VoteTransaction);
  const hasExecute = Permissions.has(
    permissions,
    Permission.ExecuteTransaction,
  );
  // If signer has full signing rights, no transaction manager is needed
  if (hasInitiate && hasVote && hasExecute) {
    return {};
  }
  if (!hasVote || !hasExecute) {
    throw new PermissionError(
      "Signer lacks the required Vote/Execute permissions.",
      ["VoteTransaction", "ExecuteTransaction"],
      [
        hasVote ? "VoteTransaction" : undefined,
        hasExecute ? "ExecuteTransaction" : undefined,
      ].filter(Boolean) as string[],
    );
  }

  // Otherwise, require a transaction manager + vote + execute rights
  const transactionManager = settingsData.members.find(
    (m) => m.role === UserRole.TransactionManager,
  );
  if (!transactionManager) {
    throw new NotFoundError(
      "Transaction manager",
      "No transaction manager available in wallet",
    );
  }

  return {
    transactionManagerAddress: address(
      convertMemberKeyToString(transactionManager.pubkey),
    ),
    userAddressTreeIndex: transactionManager.userAddressTreeIndex,
  };
}

/**
 * Gets a signed transaction manager signer
 * @param params - Parameters including auth responses, transaction manager address, etc.
 * @returns Transaction signer or null if no transaction manager is needed
 * @throws {NotFoundError} If transaction manager endpoint is missing
 */
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
  cachedAccounts?: AccountCache;
}): Promise<TransactionSigner | null> {
  if (!transactionManagerAddress) return null;
  const userAccountData = await fetchUserAccountData(
    transactionManagerAddress,
    userAddressTreeIndex,
    cachedAccounts,
  );

  if (userAccountData.transactionManagerUrl.__option === "None") {
    throw new NotFoundError(
      "Transaction manager endpoint",
      "Transaction manager endpoint is missing for this account",
    );
  }

  return createTransactionManagerSigner(
    transactionManagerAddress,
    userAccountData.transactionManagerUrl.value,
    authResponses,
    transactionMessageBytes,
  );
}

/**
 * Creates a transaction manager signer that signs transactions via HTTP
 * @param address - Transaction manager address
 * @param url - Transaction manager endpoint URL
 * @param authResponses - Optional authentication responses
 * @param transactionMessageBytes - Optional transaction message bytes
 * @returns Transaction signer
 */
export function createTransactionManagerSigner(
  address: Address,
  url: string,
  authResponses?: TransactionAuthDetails[],
  transactionMessageBytes?: ReadonlyUint8Array,
): TransactionSigner {
  return {
    address,
    async signTransactions(transactions) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: address.toString(),
          payload: transactions.map((x) => ({
            transaction: getBase64Decoder().decode(
              getTransactionEncoder().encode(x),
            ),
            transactionMessageBytes: transactionMessageBytes
              ? getBase64Decoder().decode(transactionMessageBytes)
              : undefined,
            authResponses,
          })),
        }),
      });

      if (!response.ok) {
        throw new NetworkError(
          `Transaction manager request failed: ${response.statusText}`,
          response.status,
          url,
        );
      }

      const data = (await response.json()) as
        | { signatures: string[] }
        | { error: string };

      if ("error" in data) {
        throw new NetworkError(
          `Transaction manager error: ${data.error}`,
          response.status,
          url,
        );
      }

      return data.signatures.map((sig) => ({
        [address]: getBase58Encoder().encode(sig) as SignatureBytes,
      }));
    },
  };
}

/**
 * Converts a member key to its string representation
 * @param memberKey - Member key to convert
 * @returns Base58-encoded public key string
 */
export function convertMemberKeyToString(memberKey: MemberKey): string {
  if (memberKey.keyType === KeyType.Ed25519) {
    return getBase58Decoder().decode(memberKey.key.subarray(1, 33));
  } else {
    return getBase58Decoder().decode(memberKey.key);
  }
}

/**
 * Serializes config actions to bytes
 * @param configActions - Array of config actions to serialize
 * @returns Serialized config actions as Uint8Array
 */
export function serializeConfigActions(
  configActions: ConfigAction[],
): Uint8Array {
  const encodedActions = configActions.map((x) =>
    getConfigActionEncoder().encode(x),
  );

  const totalLength = 4 + encodedActions.reduce((sum, a) => sum + a.length, 0);

  const serializedConfigActions = new Uint8Array(totalLength);

  let offset = 0;

  serializedConfigActions.set(
    getU32Encoder().encode(configActions.length),
    offset,
  );
  offset += 4;

  for (const action of encodedActions) {
    serializedConfigActions.set(action, offset);
    offset += action.length;
  }

  return serializedConfigActions;
}

/**
 * Deserializes config actions from bytes
 * @param bytes - Serialized config actions
 * @returns Array of config actions
 * @throws {ValidationError} If there are trailing bytes
 */
export function deserializeConfigActions(bytes: Uint8Array): ConfigAction[] {
  let offset = 0;
  const [count, u32offset] = getU32Decoder().read(bytes, offset);
  offset = u32offset;

  const out: ConfigAction[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const r = getConfigActionDecoder().read(bytes, offset);
    out[i] = r[0];
    offset = r[1];
  }

  if (offset !== bytes.length) {
    throw new ValidationError(
      `Trailing bytes detected: expected ${bytes.length} bytes but consumed ${offset}`,
    );
  }
  return out;
}

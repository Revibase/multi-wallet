import { sha256 } from "@noble/hashes/sha256";
import {
  address,
  type Address,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getU8Encoder,
  getUtf8Encoder,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";
import {
  type IPermissions,
  type MemberKey,
  MULTI_WALLET_PROGRAM_ADDRESS,
} from "../generated";
import {
  type IPermission,
  KeyType,
  PermanentMemberPermission,
  Permission,
  type PermissionArgs,
  Permissions,
  Secp256r1Key,
  TransactionManagerPermission,
} from "../types";
import { fetchSettingsData, fetchUserAccountData } from "./compressed";
import { getGlobalAuthorizedClient } from "./initialize";

export async function getDomainConfigAddress({
  rpIdHash,
  rpId,
}: {
  rpIdHash?: Uint8Array;
  rpId?: string;
}) {
  if (!rpIdHash) {
    if (rpId) {
      rpIdHash = sha256(new TextEncoder().encode(rpId));
    } else {
      throw new Error("RpId not found.");
    }
  }
  if (!rpIdHash) {
    throw new Error("RpIdHash not found.");
  }
  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("domain_config"), rpIdHash],
  });

  return domainConfig;
}

export async function getGlobalCounterAddress() {
  const [globalCounter] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("global_counter")],
  });

  return globalCounter;
}

export async function getTransactionBufferAddress(
  settings: Address,
  creator: Address | Secp256r1Key,
  buffer_index: number
) {
  if (buffer_index > 255) {
    throw new Error("Index cannot be greater than 255.");
  }
  const [transactionBuffer] = await getProgramDerivedAddress({
    programAddress: MULTI_WALLET_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("multi_wallet"),
      getAddressEncoder().encode(settings),
      getUtf8Encoder().encode("transaction_buffer"),
      creator instanceof Secp256r1Key
        ? creator.toTruncatedBuffer()
        : getAddressEncoder().encode(creator),
      getU8Encoder().encode(buffer_index),
    ],
  });

  return transactionBuffer;
}

export function convertMemberKeyToString(memberKey: MemberKey) {
  if (memberKey.keyType === KeyType.Ed25519) {
    return getBase58Decoder().decode(memberKey.key.subarray(1, 33));
  } else {
    return getBase58Decoder().decode(memberKey.key);
  }
}

export function convertPermissions(
  p: PermissionArgs,
  isPermanentMember = false,
  isTransactionManager = false
): IPermissions {
  const perms: IPermission[] = [];
  if (p.initiate) perms.push(Permission.InitiateTransaction);
  if (p.vote) perms.push(Permission.VoteTransaction);
  if (p.execute) perms.push(Permission.ExecuteTransaction);
  if (isPermanentMember) perms.push(PermanentMemberPermission);
  if (isTransactionManager) perms.push(TransactionManagerPermission);

  return Permissions.fromPermissions(perms);
}
export async function resolveTransactionManagerSigner({
  signer,
  index,
  transactionMessageBytes,
  authorizedClient = getGlobalAuthorizedClient(),
  cachedAccounts,
}: {
  signer: Secp256r1Key | Address;
  index: number | bigint;
  transactionMessageBytes?: ReadonlyUint8Array;
  authorizedClient?: {
    publicKey: string;
    url: string;
  } | null;
  cachedAccounts?: Map<string, any>;
}) {
  const settingsData = await fetchSettingsData(index, cachedAccounts);
  if (settingsData.threshold > 1) {
    throw new Error(
      "Multi-signature transactions with threshold > 1 are not supported yet."
    );
  }
  const { permissions } =
    settingsData.members.find(
      (m) => convertMemberKeyToString(m.pubkey) === signer.toString()
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
    return null;
  }
  if (!hasVote || !hasExecute) {
    throw new Error("Signer lacks the required Vote/Execute permissions.");
  }

  // Otherwise, require a transaction manager + vote + execute rights
  const transactionManager = settingsData.members.find((m) =>
    Permissions.has(m.permissions, TransactionManagerPermission)
  );
  if (!transactionManager) {
    throw new Error("No transaction manager available in wallet.");
  }

  const transactionManagerAddress = address(
    convertMemberKeyToString(transactionManager.pubkey)
  );

  const userAccountData = await fetchUserAccountData(
    transactionManagerAddress,
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
    transactionMessageBytes,
    authorizedClient
  );
}

function createTransactionManagerSigner(
  address: Address,
  url: string,
  transactionMessageBytes?: ReadonlyUint8Array,
  authorizedClient?: {
    publicKey: string;
    url: string;
  } | null
): TransactionSigner {
  return {
    address,
    async signTransactions(transactions) {
      const payload: Record<
        string,
        string | string[] | { publicKey: string; signatures: string[] }
      > = {
        publicKey: address.toString(),
        transactions: transactions.map(getBase64EncodedWireTransaction),
      };

      if (transactionMessageBytes) {
        payload.transactionMessageBytes = getBase64Decoder().decode(
          transactionMessageBytes
        );
      }

      if (authorizedClient) {
        const { url, publicKey } = authorizedClient;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactions: payload.transactions,
            publicKey,
          }),
        });
        const data = (await response.json()) as
          | { signatures: string[] }
          | { error: string };
        if ("error" in data) {
          throw new Error(data.error);
        }
        payload.authorizedClient = {
          publicKey,
          signatures: data.signatures,
        };
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
